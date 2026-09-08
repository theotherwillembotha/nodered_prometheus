import { NodeGenerator, MetricsService, NodeTypeService, SettingsService } from "@theotherwillembotha/node-red-plugincore";
import { WebhookTemplate, WebhookServerConfigNode, WebhookServerService } from "@theotherwillembotha/node-red-plugincore";
import { DelegatedConfigReferenceNode } from "@theotherwillembotha/node-red-plugincore";
import { PrometheusMetricsConfigNode } from "./prometheus/node/PrometheusMetricsConfigNode.js";

new NodeGenerator("./src/prometheus/")
    // templates
    .registerTemplate(WebhookTemplate)

    // services — must be registered so Node-RED serves Plugins.html and exposes the NodeTypeService API
    .registerService(MetricsService)
    .registerService(NodeTypeService)
    .registerService(SettingsService)
    .registerService(WebhookServerService)

    // infrastructure nodes — registered here so prometheus works standalone (mirrors how loki
    // re-registers ConsoleLoggerConfigNode / RestLoggerConfigNode from plugincore)
    .registerNode(DelegatedConfigReferenceNode)
    .registerNode(WebhookServerConfigNode)

    // prometheus-specific node
    .registerNode(PrometheusMetricsConfigNode)

    // done
    .generate("./build/Nodes", "./build/Plugins");

process.exit(0);
