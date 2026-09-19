import {
    Metric,
    MetricCapability,
    MetricConfig,
    MetricsConfig,
    MetricsContainer,
    CounterMetric, CounterMetricConfig, CounterCallback, CounterState,
    GaugeMetric,   GaugeMetricConfig,   GaugeCallback,   GaugeState,
    HistogramMetric, HistogramMetricConfig, HistogramCallback, HistogramState,
    SummaryMetric,   SummaryMetricConfig,  SummaryCallback,  SummaryState,
    BucketType,
    PercentileType,
    ManualPercentileConfig,
    ConfigFragmentService,
} from "@theotherwillembotha/node-red-plugincore";
import type { BaseNode, BaseNodeConfig } from "@theotherwillembotha/node-red-plugincore";
import type { Counter, Gauge, Histogram, HistogramConfiguration, Registry, Summary, SummaryConfiguration } from "prom-client";

function getPromClient(): any { return require('prom-client'); }


// ******************************************************* //
//                   Counter                               //
// ******************************************************* //

export class PrometheusCounterMetric extends Metric<CounterMetricConfig> implements CounterMetric {
    private counter: Counter;
    private internalCounter: any;
    private subscribers: { [key: string]: CounterCallback } = {};

    constructor(id: string, config: CounterMetricConfig, registry: Registry, help?: string) {
        super(config);
        this.counter = new (getPromClient().Counter)({
            name:       id,
            help:       help || config.description || config.metric,
            labelNames: Metric.labelNames(),
            registers:  [registry]
        });
        this.counter.reset();
        this.internalCounter = this.counter.labels(this.labels() as any);
    }

    public inc(): this {
        this.internalCounter.inc();
        this.counter.get().then((t: any) => {
            const state: CounterState = t.values[0];
            Object.values(this.subscribers).forEach(cb => cb(state));
        });
        return this;
    }

    public reset(): void { this.counter.reset(); }

    public get(): Promise<CounterState> {
        return this.counter.get().then((t: any) => t.values[0] as CounterState);
    }

    public subscribe(node: BaseNode<BaseNodeConfig>, callback: CounterCallback): void {
        this.subscribers[node.id()] = callback;
    }
    public unsubscribe(node: BaseNode<BaseNodeConfig>): void {
        delete this.subscribers[node.id()];
    }
}

// ******************************************************* //
//                   Gauge                                 //
// ******************************************************* //

export class PrometheusGaugeMetric extends Metric<GaugeMetricConfig> implements GaugeMetric {
    private collector: number = 0;
    private gauge: any;
    private subscribers: { [key: string]: GaugeCallback } = {};

    constructor(id: string, config: GaugeMetricConfig, registry: Registry, help?: string) {
        super(config);
        const labels = this.labels();
        this.gauge = new (getPromClient().Gauge)({
            name:       id,
            help:       help || config.description || config.metric,
            registers:  [registry],
            labelNames: Metric.labelNames(),
            collect:    () => { this.gauge.labels(labels as {}).set(this.collector); }
        });
    }

    private notify(): void {
        const state: GaugeState = { value: this.collector };
        Object.values(this.subscribers).forEach(cb => cb(state));
    }

    public inc(): this { this.collector += 1; this.notify(); return this; }
    public dec(): this { this.collector -= 1; this.notify(); return this; }
    public reset(): void { this.collector = 0; }
    public get(): GaugeState { return { value: this.collector }; }

    public subscribe(node: BaseNode<BaseNodeConfig>, callback: GaugeCallback): void {
        this.subscribers[node.id()] = callback;
    }
    public unsubscribe(node: BaseNode<BaseNodeConfig>): void {
        delete this.subscribers[node.id()];
    }
}

// ******************************************************* //
//                   Histogram                             //
// ******************************************************* //

class PrometheusHistogramState implements HistogramState {
    private _average: number | undefined;

    constructor(values: { labels: any; value: number; metricName?: string }[]) {
        const sum   = values.find(v => v.metricName?.endsWith("_sum"))?.value;
        const count = values.find(v => v.metricName?.endsWith("_count"))?.value;
        this._average = (sum != null && count != null && count !== 0) ? sum / count : undefined;
    }

    public average(): number | undefined { return this._average; }
}

export class PrometheusHistogramMetric extends Metric<HistogramMetricConfig> implements HistogramMetric {
    private histogram: Histogram;
    private subscribers: { [key: string]: HistogramCallback } = {};

    constructor(id: string, config: HistogramMetricConfig, registry: Registry, help?: string) {
        super(config);

        const histogramConfig: HistogramConfiguration<string> = {
            name:       id,
            help:       help || config.description || config.metric,
            labelNames: Metric.labelNames(),
            registers:  [registry]
        };

        if (config.buckettype === BucketType.manual) {
            histogramConfig.buckets = (config.bucketconfig as any).intervals;
        } else if (config.buckettype === BucketType.linear) {
            const bc = config.bucketconfig as any;
            histogramConfig.buckets = getPromClient().linearBuckets(bc.start, bc.interval, bc.count);
        } else if (config.buckettype === BucketType.exponential) {
            const bc = config.bucketconfig as any;
            histogramConfig.buckets = getPromClient().exponentialBuckets(bc.start, bc.factor, bc.count);
        }

        this.histogram = new (getPromClient().Histogram)(histogramConfig);
        this.histogram.zero(this.labels() as any);
    }

    public observe(value: number): void {
        this.histogram.labels(this.labels() as any).observe(value);
        this.histogram.get().then((t: any) => {
            const state = new PrometheusHistogramState(t.values);
            Object.values(this.subscribers).forEach(cb => cb(state));
        });
    }

    public reset(): void { this.histogram.reset(); }

    public subscribe(node: BaseNode<BaseNodeConfig>, callback: HistogramCallback): void {
        this.subscribers[node.id()] = callback;
    }
    public unsubscribe(node: BaseNode<BaseNodeConfig>): void {
        delete this.subscribers[node.id()];
    }
}

// ******************************************************* //
//                   Summary                               //
// ******************************************************* //

class PrometheusSummaryState implements SummaryState {
    private _average: number | undefined;

    constructor(values: { labels: any; value: number; metricName?: string }[]) {
        const sum   = values.find(v => v.metricName?.endsWith("_sum"))?.value;
        const count = values.find(v => v.metricName?.endsWith("_count"))?.value;
        this._average = (sum != null && count != null && count !== 0) ? sum / count : undefined;
    }

    public average(): number | undefined { return this._average; }
}

export class PrometheusSummaryMetric extends Metric<SummaryMetricConfig> implements SummaryMetric {
    private summary: Summary;
    private subscribers: { [key: string]: SummaryCallback } = {};

    constructor(id: string, config: SummaryMetricConfig, registry: Registry, help?: string) {
        super(config);

        const summaryConfig: SummaryConfiguration<string> = {
            name:       id,
            help:       help || config.description || config.metric,
            labelNames: Metric.labelNames(),
            registers:  [registry],
        };

        if (config.percentileType === PercentileType.default) {
            summaryConfig.percentiles = [0.01, 0.1, 0.9, 0.99];
        } else if (config.percentileType === PercentileType.manual) {
            summaryConfig.percentiles = (config.percentileConfig as ManualPercentileConfig).percentiles;
        }

        this.summary = new (getPromClient().Summary)(summaryConfig);
    }

    public observe(value: number): void {
        this.summary.labels(this.labels() as any).observe(value);
        this.summary.get().then((t: any) => {
            const state = new PrometheusSummaryState(t.values);
            Object.values(this.subscribers).forEach(cb => cb(state));
        });
    }

    public reset(): void { this.summary.reset(); }

    public subscribe(node: BaseNode<BaseNodeConfig>, callback: SummaryCallback): void {
        this.subscribers[node.id()] = callback;
    }
    public unsubscribe(node: BaseNode<BaseNodeConfig>): void {
        delete this.subscribers[node.id()];
    }
}

// ******************************************************* //
//                   PrometheusMetricsContainer            //
// ******************************************************* //

export interface PrometheusMetricsConfig extends MetricsConfig {
    metricsPath: string;
    metricsPort: number;
}

export class PrometheusMetricsContainer extends MetricsContainer {
    private _config: PrometheusMetricsConfig;
    private _registry: Registry;

    private counters:   { [key: string]: PrometheusCounterMetric }   = {};
    private gauges:     { [key: string]: PrometheusGaugeMetric }     = {};
    private histograms: { [key: string]: PrometheusHistogramMetric } = {};
    private summaries:  { [key: string]: PrometheusSummaryMetric }  = {};

    constructor(config: PrometheusMetricsConfig) {
        super();
        this._config = config;
        this._registry = new (getPromClient().Registry)();
    }

    public supports(capability: MetricCapability): boolean { return true; }

    public hasChanged(config: MetricsConfig): boolean {
        const c = config as PrometheusMetricsConfig;
        return !(
            this._config.metricsPath === c.metricsPath &&
            this._config.metricsPort === c.metricsPort
        );
    }

    public close(): void {
        this._registry.clear();
        this.counters   = {};
        this.gauges     = {};
        this.histograms = {};
        this.summaries  = {};
    }

    public registry(): Registry { return this._registry; }

    public counter(config: CounterMetricConfig, help?: string): CounterMetric {
        const id = `counter_${config.id}`;
        if (!this.counters[id]) {
            this.counters[id] = new PrometheusCounterMetric(id, config, this._registry, help);
        }
        return this.counters[id];
    }

    public gauge(config: GaugeMetricConfig, help?: string): GaugeMetric {
        const id = `gauge_${config.id}`;
        if (!this.gauges[id]) {
            this.gauges[id] = new PrometheusGaugeMetric(id, config, this._registry, help);
        }
        return this.gauges[id];
    }

    public histogram(config: HistogramMetricConfig, help?: string): HistogramMetric {
        const id = `histogram_${config.id}`;
        if (!this.histograms[id]) {
            this.histograms[id] = new PrometheusHistogramMetric(id, config, this._registry, help);
        }
        return this.histograms[id];
    }

    public summary(config: SummaryMetricConfig, help?: string): SummaryMetric {
        const id = `summary_${config.id}`;
        if (!this.summaries[id]) {
            this.summaries[id] = new PrometheusSummaryMetric(id, config, this._registry, help);
        }
        return this.summaries[id];
    }

    public createTimer(metricConfig: MetricConfig, fragmentData: any): HistogramMetric | SummaryMetric {
        const help = fragmentData.metricDescription || undefined;
        const bucketConfig: any = {};

        if (fragmentData.metricType === 'summary') {
            const summaryConfig: SummaryMetricConfig = {
                ...metricConfig,
                type: "Summary",
                percentileType:   fragmentData.percentileType || PercentileType.default,
                percentileConfig: fragmentData.percentileType === PercentileType.manual
                    ? { percentiles: (fragmentData.percentilesManual || "0.01, 0.1, 0.9, 0.99").split(",").map((s: string) => parseFloat(s.trim())) }
                    : {},
            };
            return this.summary(summaryConfig, help);
        }

        // Default: histogram
        switch (fragmentData.bucketType) {
            case 'manual':
                bucketConfig.intervals = (fragmentData.bucketsManual || "0.001, 0.01, 0.1, 1, 2, 5").split(",").map((s: string) => parseFloat(s.trim()));
                break;
            case 'linear':
                bucketConfig.start    = parseFloat(fragmentData.linearStart    || "0");
                bucketConfig.interval = parseFloat(fragmentData.linearInterval || "5");
                bucketConfig.count    = parseInt(fragmentData.linearCount      || "10");
                break;
            case 'exponential':
                bucketConfig.start  = parseFloat(fragmentData.expStart  || "1");
                bucketConfig.factor = parseFloat(fragmentData.expFactor || "2");
                bucketConfig.count  = parseInt(fragmentData.expCount   || "10");
                break;
        }

        const histogramConfig: HistogramMetricConfig = {
            ...metricConfig,
            type: "Histogram",
            buckettype:   (fragmentData.bucketType as BucketType) || BucketType.default,
            bucketconfig: bucketConfig,
        };
        return this.histogram(histogramConfig, help);
    }

    public createCounter(metricConfig: MetricConfig, fragmentData: any): CounterMetric {
        const help = fragmentData.metricDescription || undefined;
        const counterConfig: CounterMetricConfig = { ...metricConfig };
        return this.counter(counterConfig, help);
    }

    public createGauge(metricConfig: MetricConfig, fragmentData: any): GaugeMetric {
        const help = fragmentData.metricDescription || undefined;
        const gaugeConfig: GaugeMetricConfig = { ...metricConfig };
        return this.gauge(gaugeConfig, help);
    }

    public static registerFragments(): void {
        const timerHtml: string = require('../fragments/PrometheusTimerFragment.html');
        ConfigFragmentService.registerFragment({
            section: 'TimerMetricConfig',
            providerType: 'PrometheusMetricsConfigNode',
            html: timerHtml,
        });

        const counterHtml: string = require('../fragments/PrometheusCounterFragment.html');
        ConfigFragmentService.registerFragment({
            section: 'CounterMetricConfig',
            providerType: 'PrometheusMetricsConfigNode',
            html: counterHtml,
        });

        const gaugeHtml: string = require('../fragments/PrometheusGaugeFragment.html');
        ConfigFragmentService.registerFragment({
            section: 'GaugeMetricConfig',
            providerType: 'PrometheusMetricsConfigNode',
            html: gaugeHtml,
        });
    }
}

try {
    PrometheusMetricsContainer.registerFragments();
} catch(_e) {
    // Expected during build time — esbuild will inline the HTML at bundle step.
}
