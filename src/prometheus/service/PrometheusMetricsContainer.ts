import {
    Metric,
    MetricCapability,
    MetricsConfig,
    MetricsContainer,
    CounterMetric, CounterMetricConfig, CounterCallback, CounterState,
    GaugeMetric,   GaugeMetricConfig,   GaugeCallback,   GaugeState,
    HistogramMetric, HistogramMetricConfig, HistogramCallback, HistogramState,
    SummaryMetric,   SummaryMetricConfig,  SummaryCallback,  SummaryState,
    BucketType,
    PercentileType,
    ManualPercentileConfig,
} from "@theotherwillembotha/node-red-plugincore";
import type { BaseNode, BaseNodeConfig } from "@theotherwillembotha/node-red-plugincore";
import type { Counter, Gauge, Histogram, HistogramConfiguration, Registry, Summary, SummaryConfiguration } from "prom-client";

function getPromClient(): any { return require('prom-client'); }
function getDeepEqual(): any  { return require('deep-equal'); }

// ******************************************************* //
//                   Counter                               //
// ******************************************************* //

export class PrometheusCounterMetric extends Metric<CounterMetricConfig> implements CounterMetric {
    private counter: Counter;
    private internalCounter: any;
    private subscribers: { [key: string]: CounterCallback } = {};

    constructor(id: string, config: CounterMetricConfig, registry: Registry) {
        super(config);
        this.counter = new (getPromClient().Counter)({
            name:       id,
            help:       config.metricdescription ?? config.metricname,
            labelNames: Object.keys(this.labels()),
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

    constructor(id: string, config: GaugeMetricConfig, registry: Registry) {
        super(config);
        const labels = this.labels();
        this.gauge = new (getPromClient().Gauge)({
            name:       id,
            help:       config.metricdescription ?? config.metricname,
            registers:  [registry],
            labelNames: Object.keys(labels),
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

    constructor(id: string, config: HistogramMetricConfig, registry: Registry) {
        super(config);

        const histogramConfig: HistogramConfiguration<string> = {
            name:       id,
            help:       config.metricdescription ?? config.metricname,
            labelNames: Object.keys(this.labels()),
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

    constructor(id: string, config: SummaryMetricConfig, registry: Registry) {
        super(config);

        const summaryConfig: SummaryConfiguration<string> = {
            name:       id,
            help:       config.metricdescription ?? config.metricname,
            labelNames: Object.keys(this.labels()),
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

    public close(): void { this._registry.clear(); }

    public registry(): Registry { return this._registry; }

    public counter(config: CounterMetricConfig): CounterMetric {
        const id = `counter_${config.node.id}`;
        let metric = this.counters[id];
        if (metric) {
            if (!getDeepEqual()(metric.config(), config)) {
                this._registry.removeSingleMetric(id);
                this.counters[id] = metric = new PrometheusCounterMetric(id, config, this._registry);
            }
        } else {
            this.counters[id] = metric = new PrometheusCounterMetric(id, config, this._registry);
        }
        return metric;
    }

    public gauge(config: GaugeMetricConfig): GaugeMetric {
        const id = `gauge_${config.node.id}`;
        let metric = this.gauges[id];
        if (metric) {
            if (!getDeepEqual()(metric.config(), config)) {
                this._registry.removeSingleMetric(id);
                this.gauges[id] = metric = new PrometheusGaugeMetric(id, config, this._registry);
            }
        } else {
            this.gauges[id] = metric = new PrometheusGaugeMetric(id, config, this._registry);
        }
        return metric;
    }

    public histogram(config: HistogramMetricConfig): HistogramMetric {
        const id = `histogram_${config.node.id}`;
        let metric = this.histograms[id];
        if (metric) {
            if (!getDeepEqual()(metric.config(), config)) {
                this._registry.removeSingleMetric(id);
                this.histograms[id] = metric = new PrometheusHistogramMetric(id, config, this._registry);
            }
        } else {
            this.histograms[id] = metric = new PrometheusHistogramMetric(id, config, this._registry);
        }
        return metric;
    }

    public summary(config: SummaryMetricConfig): SummaryMetric {
        const id = `summary_${config.node.id}`;
        let metric = this.summaries[id];
        if (metric) {
            if (!getDeepEqual()(metric.config(), config)) {
                this._registry.removeSingleMetric(id);
                this.summaries[id] = metric = new PrometheusSummaryMetric(id, config, this._registry);
            }
        } else {
            this.summaries[id] = metric = new PrometheusSummaryMetric(id, config, this._registry);
        }
        return metric;
    }
}
