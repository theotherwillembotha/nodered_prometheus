
import { Node } from "node-red";
import { BaseNode, BaseNodeConfig, JsonUtil, NodeDescription, NodeManager, onInput, SourceUtility } from "@theotherwillembotha/node-red-plugincore";
import { NodeMessageInFlow } from "node-red";

interface PrometheusDecodeNodeConfig extends BaseNodeConfig {
    inputpath: string;
    inputpath_type: string;
    outputpath: string;
}

interface ParsedMetric {
    type: string;
    help: string;
    tags: { [key: string]: string };
    [key: string]: any;
}

@NodeDescription({
    id: "PrometheusDecodeNode",
    name: "Prometheus Decode",
    group: "prometheus",
    sourceFile: SourceUtility.getSourcePath("/build/", "/src/") + "PrometheusDecodeNode.html",
    package: "@theotherwillembotha/node-red-prometheus",
    tags: ["Prometheus"]
})
export class PrometheusDecodeNode extends BaseNode<PrometheusDecodeNodeConfig> {

    constructor(node: Node, config: PrometheusDecodeNodeConfig) {
        super(node, config);
    }

    @onInput()
    protected onInput(message: any, errorHandler: Function) {
        NodeManager.RED.util.evaluateNodeProperty(
            this.config().inputpath,
            this.config().inputpath_type || "msg",
            this.node() as any,
            message as NodeMessageInFlow,
            (err: any, input: any) => {
                if (err || input === undefined || input === null) {
                    errorHandler(new Error("Could not resolve input path"));
                    return;
                }
                try {
                    const text = typeof input === "string" ? input : String(input);
                    const result = PrometheusDecodeNode.parse(text);
                    const outputpath = this.config().outputpath || "payload";
                    JsonUtil.jsonUpdate(message, outputpath, result);
                    this.node().send([message]);
                } catch (e: any) {
                    errorHandler(e);
                }
            }
        );
    }

    public static parse(text: string): { [key: string]: ParsedMetric } {
        const lines = text.split("\n");
        const helpMap: { [key: string]: string } = {};
        const typeMap: { [key: string]: string } = {};
        const result: { [key: string]: ParsedMetric } = {};

        // First pass: collect HELP and TYPE directives
        for (const line of lines) {
            if (line.startsWith("# HELP ")) {
                const rest = line.substring(7);
                const spaceIdx = rest.indexOf(" ");
                if (spaceIdx > 0) {
                    helpMap[rest.substring(0, spaceIdx)] = rest.substring(spaceIdx + 1);
                }
            } else if (line.startsWith("# TYPE ")) {
                const rest = line.substring(7);
                const spaceIdx = rest.indexOf(" ");
                if (spaceIdx > 0) {
                    typeMap[rest.substring(0, spaceIdx)] = rest.substring(spaceIdx + 1);
                }
            }
        }

        // Second pass: parse sample lines
        for (const line of lines) {
            if (line === "" || line.startsWith("#")) continue;

            const { name, labels, value } = PrometheusDecodeNode.parseSampleLine(line);
            if (!name) continue;

            // Determine the base metric name by stripping known suffixes
            const baseName = PrometheusDecodeNode.getBaseName(name, typeMap);
            const type = typeMap[baseName] || "untyped";
            const suffix = name.substring(baseName.length);

            if (!result[baseName]) {
                result[baseName] = {
                    type,
                    help: helpMap[baseName] || "",
                    tags: {},
                };

                if (type === "histogram") {
                    result[baseName].buckets = {};
                } else if (type === "summary") {
                    result[baseName].quantiles = {};
                }
            }

            const metric = result[baseName];

            // Merge labels, excluding "le" (histogram bucket bound) and "quantile" (summary quantile)
            for (const [k, v] of Object.entries(labels)) {
                if (k !== "le" && k !== "quantile") {
                    metric.tags[k] = v;
                }
            }

            // Assign value to the right field
            if (type === "histogram") {
                if (suffix === "_bucket") {
                    const le = labels["le"] ?? "";
                    metric.buckets[le] = value;
                } else if (suffix === "_sum") {
                    metric.sum = value;
                } else if (suffix === "_count") {
                    metric.count = value;
                }
            } else if (type === "summary") {
                if (suffix === "_sum") {
                    metric.sum = value;
                } else if (suffix === "_count") {
                    metric.count = value;
                } else if ("quantile" in labels) {
                    metric.quantiles[labels["quantile"]] = value;
                }
            } else {
                // counter, gauge, untyped
                metric.value = value;
            }
        }

        return result;
    }

    private static parseSampleLine(line: string): { name: string; labels: { [key: string]: string }; value: number } {
        let idx = 0;
        const labels: { [key: string]: string } = {};

        // Parse metric name
        const braceIdx = line.indexOf("{");
        const spaceBeforeBrace = line.indexOf(" ");

        let nameEnd: number;
        if (braceIdx > 0 && (braceIdx < spaceBeforeBrace || spaceBeforeBrace < 0)) {
            nameEnd = braceIdx;
        } else {
            nameEnd = spaceBeforeBrace;
        }

        if (nameEnd < 0) return { name: "", labels, value: 0 };

        const name = line.substring(0, nameEnd);
        idx = nameEnd;

        // Parse labels if present
        if (line[idx] === "{") {
            const closeBrace = line.indexOf("}", idx);
            if (closeBrace < 0) return { name: "", labels, value: 0 };

            const labelStr = line.substring(idx + 1, closeBrace);
            const labelPairs = PrometheusDecodeNode.parseLabels(labelStr);
            for (const [k, v] of labelPairs) {
                labels[k] = v;
            }
            idx = closeBrace + 1;
        }

        // Skip whitespace and parse value
        const valueStr = line.substring(idx).trim().split(/\s/)[0];
        const value = parseFloat(valueStr);

        return { name, labels, value };
    }

    private static parseLabels(labelStr: string): [string, string][] {
        const result: [string, string][] = [];
        let i = 0;

        while (i < labelStr.length) {
            // Skip whitespace and commas
            while (i < labelStr.length && (labelStr[i] === " " || labelStr[i] === ",")) i++;
            if (i >= labelStr.length) break;

            // Parse key
            const eqIdx = labelStr.indexOf("=", i);
            if (eqIdx < 0) break;
            const key = labelStr.substring(i, eqIdx).trim();

            // Parse value (quoted string)
            i = eqIdx + 1;
            if (labelStr[i] !== '"') break;
            i++; // skip opening quote

            let value = "";
            while (i < labelStr.length && labelStr[i] !== '"') {
                if (labelStr[i] === "\\" && i + 1 < labelStr.length) {
                    const next = labelStr[i + 1];
                    if (next === "n") { value += "\n"; i += 2; continue; }
                    if (next === "\\") { value += "\\"; i += 2; continue; }
                    if (next === '"') { value += '"'; i += 2; continue; }
                }
                value += labelStr[i];
                i++;
            }
            i++; // skip closing quote

            result.push([key, value]);
        }

        return result;
    }

    private static getBaseName(sampleName: string, typeMap: { [key: string]: string }): string {
        // Try exact match first
        if (typeMap[sampleName]) return sampleName;

        // Try stripping known suffixes
        const suffixes = ["_bucket", "_count", "_sum", "_total", "_created", "_info"];
        for (const suffix of suffixes) {
            if (sampleName.endsWith(suffix)) {
                const candidate = sampleName.substring(0, sampleName.length - suffix.length);
                if (typeMap[candidate]) return candidate;
            }
        }

        // Fallback: return the sample name as-is
        return sampleName;
    }
}
