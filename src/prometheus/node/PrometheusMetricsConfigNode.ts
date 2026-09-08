import { Node } from "node-red";
import { ConfigNodeConfig, NodeDescriptor, SourceUtility } from "@theotherwillembotha/node-red-plugincore";
import { MetricsConfigNode, MetricsContainer, MetricsConfig } from "@theotherwillembotha/node-red-plugincore";
import { NodeDescription } from "@theotherwillembotha/node-red-plugincore";
import { Webhook } from "@theotherwillembotha/node-red-plugincore";
import { EndpointMethodType } from "@theotherwillembotha/node-red-plugincore";
import { WebhookTemplate, WebhookTemplateConfig } from "@theotherwillembotha/node-red-plugincore";
import type { Request, Response } from 'express';
import { PrometheusMetricsContainer, PrometheusMetricsConfig } from "../service/PrometheusMetricsContainer";

function getPrometheusRegistry(): any { return require('prom-client').register; }

interface PrometheusMetricsConfigNodeConfig extends ConfigNodeConfig, WebhookTemplateConfig {
    metricsPath: string;
    metricsPort: number;
}

@NodeDescription({
    id: "PrometheusMetricsConfigNode",
    name: "Prometheus Metrics Config",
    group: "config",
    sourceFile: SourceUtility.getSourcePath("/build/", "/src/") + "PrometheusMetricsConfigNode.html",
    package: "@theotherwillembotha/node-red-prometheus",
    templates: [
        { template: WebhookTemplate, config: {} }
    ],
    tags: ["MetricsProvider"]
})
export class PrometheusMetricsConfigNode extends MetricsConfigNode {

    constructor(node: Node, config: PrometheusMetricsConfigNodeConfig) {
        super(node, config);
    }

    protected createContainer(baseConfig: MetricsConfig): MetricsContainer {
        const config = this.config() as PrometheusMetricsConfigNodeConfig;
        const prometheusConfig: PrometheusMetricsConfig = {
            id:          baseConfig.id,
            metricsPath: config.metricsPath,
            metricsPort: config.metricsPort,
        };
        return new PrometheusMetricsContainer(prometheusConfig);
    }

    @Webhook({ name: "PrometheusMetricsConfigNode", methods: [EndpointMethodType.GET] })
    private onWebhookRequest(_request: Request, response: Response): void {
        const container = this.metrics() as PrometheusMetricsContainer;
        response.set('Content-Type', getPrometheusRegistry().contentType);
        container.registry().metrics().then((data: any) => response.status(200).send(data));
    }
}
