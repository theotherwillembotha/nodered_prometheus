import { NodeGenerator, NodeTypeService } from "@theotherwillembotha/node-red-plugincore";
import { PrometheusMetricsConfigNode } from "./prometheus/node/PrometheusMetricsConfigNode.js";
import { PrometheusDecodeNode } from "./prometheus/node/PrometheusDecodeNode.js";

// Only register leaf nodes and NodeTypeService.
// All infrastructure (services, templates, DelegatedConfigReferenceNode)
// is resolved automatically from @NodeDescription and @TemplateDescription
// dependency chains.
new NodeGenerator("./src/prometheus/")
    .registerService(NodeTypeService)
    .registerNode(PrometheusMetricsConfigNode)
    .registerNode(PrometheusDecodeNode)
    .generate("./build/Nodes", "./build/Plugins", "@theotherwillembotha/node-red-prometheus");

process.exit(0);
