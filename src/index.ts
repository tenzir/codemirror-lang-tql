import { parser } from "./syntax.grammar";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { completeFromList } from "@codemirror/autocomplete";

export const data = [
  {
    label: "import",
    type: "keyword",
    detail:
      "Imports events into a Tenzir node. The dual to [`export`](../sources/export.md).",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>import\n</code></pre>\n<h2>Description</h2>\n<p>The <code>import</code> operator persists events in a Tenzir node.</p>\n<p>:::note Flush to disk\nPipelines ending in the <code>import</code> operator do not wait until all events in the\npipelines are written to disk.</p>\n<p>We plan to change this behavior in the near future. Until then, we recommend\nrunning <code>tenzir-ctl flush</code> after importing events to make sure they're available\nfor downstream consumption.\n:::</p>\n<h2>Examples</h2>\n<p>Import Zeek conn logs into a Tenzir node.</p>\n<pre><code>from file conn.log read zeek-tsv | import\n</code></pre>",
  },
  {
    label: "save",
    type: "keyword",
    detail:
      "The `save` operator acquires raw bytes from a [connector][connectors].",
    processedHTML:
      '<p>:::warning Expert Operator\nThe <code>save</code> operator is a lower-level building block of the <a href="to.md"><code>to</code></a> and\n<a href="write.md"><code>write</code></a> operators. Only use this if you need to operate on raw\nbytes.\n:::</p>\n<h2>Synopsis</h2>\n<pre><code>save &#x3C;connector>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>save</code> operator operates on raw bytes.</p>\n<p>Notably, it cannot be used after an operator that emits events, but rather only\nwith operators that emit bytes, e.g., <a href="../transformations/print.md"><code>print</code></a> or\n<a href="../sources/load.md"><code>load</code></a>.</p>\n<h3><code>&#x3C;connector></code></h3>\n<p>The <a href="../../connectors.md">connector</a> used to save bytes.</p>\n<p>Some connectors have connector-specific options. Please refer to the\ndocumentation of the individual connectors for more information.</p>\n<h2>Examples</h2>\n<p>Write bytes to stdout:</p>\n<pre><code>save stdin\n</code></pre>\n<p>Write bytes to the file <code>path/to/eve.json</code>:</p>\n<pre><code>save file path/to/eve.json\n</code></pre>',
  },
  {
    label: "serve",
    type: "keyword",
    detail: "Make events available under the [`/serve` REST API",
    processedHTML:
      '<p>endpoint](/api#/paths/~1serve/post).</p>\n<h2>Synopsis</h2>\n<pre><code>serve [--buffer-size &#x3C;buffer-size>] &#x3C;serve-id>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>serve</code> operator bridges between pipelines and the corresponding <code>/serve</code>\nREST API endpoint.</p>\n<p>Pipelines ending with the <code>serve</code> operator exit when all events have been\ndelivered over the corresponding endpoint.</p>\n<h3><code>--buffer-size &#x3C;buffer-size></code></h3>\n<p>The buffer size specifies the maximum number of events to keep in the <code>serve</code>\noperator to make them instantly available in the corresponding endpoint before\nthrottling the pipeline execution.</p>\n<p>Defaults to <code>64Ki</code>.</p>\n<h3><code>&#x3C;serve-id></code></h3>\n<p>The serve id is an identifier that uniquely identifies the operator. The <code>serve</code>\noperator errors when receiving a duplicate serve id.</p>\n<h2>Examples</h2>\n<p>Read a Zeek conn.log, 100 events at a time:</p>\n<pre><code class="language-bash">tenzir \'from file path/to/conn.log read zeek-tsv | serve zeek-conn-logs\'\n</code></pre>\n<pre><code class="language-bash">curl \\\n  -X POST \\\n  -H "Content-Type: application/json" \\\n  -d \'{"serve_id": "zeek-conn-logs", "continuation_token": null, "timeout": "1s", max_events": 100}\' \\\n  http://localhost:5160/api/v0/serve\n</code></pre>\n<p>This will return up to 100 events, or less if the specified timeout of 1 second\nexpired.</p>\n<p>Subsequent results for further events must specify a continuation token. The\ntoken is included in the response under <code>next_continuation_token</code> if there are\nfurther events to be retrieved from the endpoint.</p>',
  },
  {
    label: "to",
    type: "keyword",
    detail:
      "Consumes events by combining a [connector][connectors] and a [format][formats].",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>to &#x3C;connector> [write &#x3C;format>]\nwrite &#x3C;format> [to &#x3C;connector>]\n</code></pre>\n<h2>Description</h2>\n<p>The <code>to</code> operator consumes events at the end of a pipeline by bringing together\na <a href="../../connectors.md">connector</a> and a <a href="../../formats.md">format</a>.</p>\n<p>All connectors have a default format, which depends on the connector. Similarly,\nall formats have a default connector, which is <code>stdin</code> or <code>stdout</code>. This enables\na shorter syntax, e.g., <code>write json</code> uses the<code>stdout</code> connector and <code>to stdout</code>\nthe <code>json</code> format.</p>\n<p>The <code>to</code> operator is a pipeline under the hood. For most cases, it is equal to\n<code>print &#x3C;format> | save &#x3C;connector></code>. However, for some combinations of\nconnectors and formats the underlying pipeline is a bit more complex. We\nrecommend always using <code>to</code> or <a href="write.md"><code>write</code></a> over\n<a href="../transformations/print.md"><code>print</code></a> and <a href="save.md"><code>save</code></a>.</p>\n<h3><code>&#x3C;connector></code></h3>\n<p>The <a href="../../connectors.md">connector</a> used to save bytes.</p>\n<p>Some connectors have connector-specific options. Please refer to the\ndocumentation of the individual connectors for more information.</p>\n<h3><code>&#x3C;format></code></h3>\n<p>The <a href="../../formats.md">format</a> used to print events to bytes.</p>\n<p>Some formats have format-specific options. Please refer to the documentation of\nthe individual formats for more information.</p>\n<h2>Examples</h2>\n<p>Write events to stdout formatted as CSV.</p>\n<pre><code>to stdout write csv\n</code></pre>\n<p>Write events to the file <code>path/to/eve.json</code> formatted as JSON.</p>\n<pre><code>write json to file path/to/eve.json\n</code></pre>',
  },
  {
    label: "write",
    type: "keyword",
    detail:
      "The `write` operator is a short form of the [`to`](to.md) operator that allows",
    processedHTML:
      '<p>for omitting the connector.</p>\n<p>Please refer to the documentation of <a href="to.md"><code>to</code></a>.</p>',
  },
  {
    label: "export",
    type: "keyword",
    detail:
      "Retrieves events from a Tenzir node. The dual to [`import`](../sinks/import.md).",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>export\n</code></pre>\n<h2>Description</h2>\n<p>The <code>export</code> operator retrieves events from a Tenzir node.</p>\n<p>:::note Flush to disk\nPipelines starting with the <code>export</code> operator do not access events that are not\nwritten to disk.</p>\n<p>We recommend running <code>tenzir-ctl flush</code> before exporting events to make sure\nthey\'re available for downstream consumption.\n:::</p>\n<h2>Examples</h2>\n<p>Expose all persisted events as JSON data.</p>\n<pre><code>export | to stdout\n</code></pre>\n<p><a href="../transformations/where.md">Apply a filter</a> to all persisted events, then\n<a href="../transformations/head.md">only expose the first ten results</a>.</p>\n<pre><code>export | where 1.2.3.4 | head 10 | to stdout\n</code></pre>',
  },
  {
    label: "from",
    type: "keyword",
    detail:
      "Produces events by combining a [connector][connectors] and a [format][formats].",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>from &#x3C;connector> [read &#x3C;format>]\nread &#x3C;format> [from &#x3C;connector>]\n</code></pre>\n<h2>Description</h2>\n<p>The <code>from</code> operator produces events at the beginning of a pipeline by bringing\ntogether a <a href="../../connectors.md">connector</a> and a <a href="../../formats.md">format</a>.</p>\n<p>Some connectors have a default format, and some formats have a default\nconnector. This enables a shorter syntax, e.g., <code>read json</code> uses the\n<code>stdin</code> connector and <code>from stdin</code> the <code>json</code> format.</p>\n<p>The <code>from</code> operator is a pipeline under the hood. For most cases, it is equal to\n<code>load &#x3C;connector> | parse &#x3C;format></code>. However, for some combinations of\nconnectors and formats the underlying pipeline is a lot more complex. We\nrecommend always using <code>from</code> or <a href="read.md"><code>read</code></a> over <a href="load.md"><code>load</code></a> and\n<a href="../transformations/parse.md"><code>parse</code></a>.</p>\n<h3><code>&#x3C;connector></code></h3>\n<p>The <a href="../../connectors.md">connector</a> used to load bytes.</p>\n<p>Some connectors have connector-specific options. Please refer to the\ndocumentation of the individual connectors for more information.</p>\n<h3><code>&#x3C;format></code></h3>\n<p>The <a href="../../formats.md">format</a> used to parse events from the loaded bytes.</p>\n<p>Some formats have format-specific options. Please refer to the documentation of\nthe individual formats for more information.</p>\n<h2>Examples</h2>\n<p>Read bytes from stdin and parse them as JSON.</p>\n<pre><code>from stdin read json\nfrom file stdin read json\nfrom file - read json\nfrom - read json\n</code></pre>\n<p>Read bytes from the file <code>path/to/eve.json</code> and parse them as Suricata.\nNote that the <code>file</code> connector automatically assigns the Suricata parser for\n<code>eve.json</code> files when no other parser is specified.</p>\n<pre><code>from file path/to/eve.json\nfrom file path/to/eve.json read suricata\n</code></pre>',
  },
  {
    label: "load",
    type: "keyword",
    detail:
      "The `load` operator acquires raw bytes from a [connector][connectors].",
    processedHTML:
      '<p>:::warning Expert Operator\nThe <code>load</code> operator is a lower-level building block of the <a href="from.md"><code>from</code></a> and\n<a href="read.md"><code>read</code></a> operators. Only use this if you need to operate on raw bytes.\n:::</p>\n<h2>Synopsis</h2>\n<pre><code>load &#x3C;connector>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>load</code> operator emits raw bytes.</p>\n<p>Notably, it cannot be used together with operators that expect events as input,\nbut rather only with operators that expect bytes, e.g.,\n<a href="../transformations/parse.md"><code>parse</code></a> or <a href="../sinks/save.md"><code>save</code></a>.</p>\n<h3><code>&#x3C;connector></code></h3>\n<p>The <a href="../../connectors.md">connector</a> used to load bytes.</p>\n<p>Some connectors have connector-specific options. Please refer to the\ndocumentation of the individual connectors for more information.</p>\n<h2>Examples</h2>\n<p>Read bytes from stdin:</p>\n<pre><code>load stdin\n</code></pre>\n<p>Read bytes from the file <code>path/to/eve.json</code>:</p>\n<pre><code>from file path/to/eve.json\n</code></pre>',
  },
  {
    label: "read",
    type: "keyword",
    detail:
      "The `read` operator is a short form of the [`from`](from.md) operator that",
    processedHTML:
      '<p>allows for omitting the connector.</p>\n<p>Please refer to the documentation of <a href="from.md"><code>from</code></a>.</p>',
  },
  {
    label: "shell",
    type: "keyword",
    detail: "Executes a system command and hooks its stdout into the pipeline.",
    processedHTML:
      '<p>Refer to <a href="../transformations/shell.md"><code>shell</code> as transformation</a> for usage\ninstructions. The difference to the transformation is that the source operator\nignores the command\'s stdin.</p>',
  },
  {
    label: "version",
    type: "keyword",
    detail: "Returns a single event displaying version information of Tenzir.",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>version [--dev]\n</code></pre>\n<h2>Description</h2>\n<p>The version operator returns detailed information about Tenzir. The output of\nthe operator has the following schema:</p>\n<pre><code>record {\n  // The version number of Tenzir.\n  version: string,\n  // A list of plugins. Excludes builtins.\n  plugins: list&#x3C;record {\n    // The plugin name.\n    name: string,\n    // The version of the plugin.\n    version: string,\n  }>,\n}\n</code></pre>\n<h3><code>--dev</code></h3>\n<p>Add additional, developer-facing information to the output of the operator. With\n<code>--dev</code> set, the operator's output has the following schema:</p>\n<pre><code>record {\n  // The version number of Tenzir.\n  version: string,\n  // Build information for Tenzir.\n  build: record {\n    // The configured build type; one of Debug, RelWithDebInfo or Release.\n    type: string,\n    // A hash that uniquely describes the Tenzir build tree.\n    tree_hash: string,\n    // Whether assertions are enabled.\n    assertions: bool,\n    // Information about enabled sanitizers.\n    sanitizers: record {\n      // Whether ASan is enabled.\n      address: bool,\n      // Whether UBSan is enabled.\n      undefined_behavior: bool,\n    },\n  },\n  // A list of plugins. Includes builtins.\n  plugins: list&#x3C;record {\n    // The plugin name.\n    name: string,\n    // The version of the plugin.\n    version: string,\n    // The types of the plugins, e.g., printer and parser.\n    types: list&#x3C;string>,\n    // The kind of the plugin; one of static, dynamic, or builtin.\n    kind: string,\n  }>,\n\n}\n</code></pre>\n<h2>Examples</h2>\n<p>Get the version of your Tenzir process.</p>\n<pre><code>version\n</code></pre>\n<p>Get extended version information of the remote Tenzir node.</p>\n<pre><code>remote version --dev\n</code></pre>",
  },
  {
    label: "drop",
    type: "keyword",
    detail: "Drops fields from the input. The dual to [`select`](select.md).",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>drop &#x3C;extractor>...\n</code></pre>\n<h2>Description</h2>\n<p>The <code>drop</code> operator removes all fields matching the provided extractors and\nkeeps all other fields.</p>\n<p>In relational algebra, <code>drop</code> performs a <em>projection</em> of the complement of the\nprovided arguments.</p>\n<h3><code>&#x3C;extractor>...</code></h3>\n<p>A list of extractors identifying fields to remove.</p>\n<h2>Examples</h2>\n<p>Remove the fields <code>foo</code> and <code>bar</code>:</p>\n<pre><code>drop foo, bar\n</code></pre>\n<p>Remove all fields of type <code>ip</code>:</p>\n<pre><code>drop :ip\n</code></pre>",
  },
  {
    label: "enumerate",
    type: "keyword",
    detail: "Prepend a column with row numbers.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>enumerate [&#x3C;field>]\n</code></pre>\n<h2>Description</h2>\n<p>The <code>enumerate</code> operator prepends a new column with row numbers to the beginning\nof the input record.</p>\n<p>:::note Per-schema Counting\nThe operator counts row numbers per schema. We plan to change this behavior with\na in the future once we have a modifer that toggles "per-schema-ness"\nexplicitly.\n:::</p>\n<h3><code>&#x3C;field></code></h3>\n<p>Sets the name of the output field.</p>\n<p>Defaults to <code>#</code> to avoid conflicts with existing field names.</p>\n<h2>Examples</h2>\n<p>Enumerate the input by prepending row numbers:</p>\n<pre><code>from file eve.json read suricata | select event_type | enumerate | write json\n</code></pre>\n<pre><code class="language-json">{"#": 0, "event_type": "alert"}\n{"#": 0, "event_type": "flow"}\n{"#": 1, "event_type": "flow"}\n{"#": 0, "event_type": "http"}\n{"#": 1, "event_type": "alert"}\n{"#": 1, "event_type": "http"}\n{"#": 2, "event_type": "flow"}\n{"#": 0, "event_type": "fileinfo"}\n{"#": 3, "event_type": "flow"}\n{"#": 4, "event_type": "flow"}\n</code></pre>\n<p>Use <code>index</code> as field name instead of the default:</p>\n<pre><code>enumerate index\n</code></pre>',
  },
  {
    label: "extend",
    type: "keyword",
    detail: "Appends fields to events.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>extend &#x3C;field=operand>...\n</code></pre>\n<h2>Description</h2>\n<p>The <code>extend</code> appends a specified list of fields to the input. All existing\nfields remain intact.</p>\n<p>The difference between <code>extend</code> and <a href="put.md"><code>put</code></a> is that <code>put</code> drops all\nfields not explicitly specified, whereas <code>extend</code> only appends fields.</p>\n<p>The difference between <code>extend</code> and <a href="replace.md"><code>replace</code></a> is that <code>replace</code>\noverwrites existing fields, whereas <code>extend</code> doesn\'t touch the input.</p>\n<h3><code>&#x3C;field=operand></code></h3>\n<p>The assignment consists of <code>field</code> that describes the new field name and\n<code>operand</code> that defines the field value.</p>\n<h3>Examples</h3>\n<p>Add new fields with fixed values:</p>\n<pre><code>extend secret="xxx", ints=[1, 2, 3], strs=["a", "b", "c"]\n</code></pre>\n<p>Duplicate a column:</p>\n<pre><code>extend source=src_ip\n</code></pre>',
  },
  {
    label: "hash",
    type: "keyword",
    detail: "Computes a SHA256 hash digest of a given field.",
    processedHTML:
      '<p>:::warning Deprecated\nThis operator will soon be removed in favor of first-class support for functions\nthat can be used in a variety of different operators and contexts.\n:::</p>\n<h2>Synopsis</h2>\n<pre><code>hash [-s|--salt=&#x3C;string>] &#x3C;field>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>hash</code> operator calculates a hash digest of a given field.</p>\n<h3><code>&#x3C;-s|--salt>=&#x3C;string></code></h3>\n<p>A salt value for the hash.</p>\n<h3><code>&#x3C;field></code></h3>\n<p>The field over which the hash is computed.</p>\n<h2>Examples</h2>\n<p>Hash all values of the field <code>username</code> using the salt value <code>"xxx"</code> and store\nthe digest in a new field <code>username_hashed</code>:</p>\n<pre><code>hash --salt="B3IwnumKPEJDAA4u" username\n</code></pre>',
  },
  {
    label: "head",
    type: "keyword",
    detail: "Limits the input to the first *N* events.",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>head [&#x3C;limit>]\n</code></pre>\n<h2>Description</h2>\n<p>The semantics of the <code>head</code> operator are the same of the equivalent Unix tool:\nprocess a fixed number of events from the input. The operator terminates\nafter it has reached its limit.</p>\n<h3><code>&#x3C;limit></code></h3>\n<p>An unsigned integer denoting how many events to keep.</p>\n<p>Defaults to 10.</p>\n<h2>Examples</h2>\n<p>Get the first ten events:</p>\n<pre><code>head\n</code></pre>\n<p>Get the first five events:</p>\n<pre><code>head 5\n</code></pre>",
  },
  {
    label: "measure",
    type: "keyword",
    detail: "Replaces the input with metrics describing the input.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>measure [--real-time] [--cumulative]\n</code></pre>\n<h2>Description</h2>\n<p>The <code>measure</code> operator yields metrics for each received batch of events or bytes\nusing the following schema, respectively:</p>\n<pre><code class="language-title=&#x22;Events">type tenzir.metrics.events = record  {\n  timestamp: time,\n  schema: string,\n  schema_id: string,\n  events: uint64,\n}\n</code></pre>\n<pre><code class="language-title=&#x22;Bytes">type tenzir.metrics.bytes = record  {\n  timestamp: time,\n  bytes: uint64,\n}\n</code></pre>\n<h3><code>--real-time</code></h3>\n<p>Emit metrics immediately with every batch, rather than buffering until the\nupstream operator stalls, i.e., is idle or waiting for further input.</p>\n<p>The <code>--real-time</code> option is useful when inspect should emit data without\nlatency.</p>\n<h3><code>--cumulative</code></h3>\n<p>Emit running totals for the <code>events</code> and <code>bytes</code> fields rather than per-batch\nstatistics.</p>\n<h2>Examples</h2>\n<p>Get the number of bytes read incrementally for a file:</p>\n<pre><code class="language-json">{"timestamp": "2023-04-28T10:22:10.192322", "bytes": 16384}\n{"timestamp": "2023-04-28T10:22:10.223612", "bytes": 16384}\n{"timestamp": "2023-04-28T10:22:10.297169", "bytes": 16384}\n{"timestamp": "2023-04-28T10:22:10.387172", "bytes": 16384}\n{"timestamp": "2023-04-28T10:22:10.408171", "bytes": 8232}\n</code></pre>\n<p>Get the number of events read incrementally from a file:</p>\n<pre><code class="language-json">{"timestamp": "2023-04-28T10:26:45.159885", "events": 65536, "schema": "suricata.dns", "schema_id": "d49102998baae44a"}\n{"timestamp": "2023-04-28T10:26:45.812321", "events": 412, "schema": "suricata.dns", "schema_id": "d49102998baae44a"}\n</code></pre>\n<p>Get the total number of events in a file, grouped by schema:</p>\n<pre><code class="language-json">{"events": 65948, "schema": "suricata.dns"}\n</code></pre>',
  },
  {
    label: "parse",
    type: "keyword",
    detail: "The `parse` operator converts raw bytes into events.",
    processedHTML:
      '<p>:::warning Expert Operator\nThe <code>parse</code> operator is a lower-level building block of the\n<a href="../sources/from.md"><code>from</code></a> and <a href="../sources/read.md"><code>read</code></a> operators. Only\nuse this if you need to operate on the raw bytes themselves.\n:::</p>\n<h2>Synopsis</h2>\n<pre><code>parse &#x3C;format>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>parse</code> operator parses events by interpreting its input bytes in a given\nformat.</p>\n<h3><code>&#x3C;format></code></h3>\n<p>The <a href="../../formats.md">format</a> used to convert raw bytes into events.</p>\n<p>Some formats have format-specific options. Please refer to the documentation of\nthe individual formats for more information.</p>\n<h2>Examples</h2>\n<p>Parse the input bytes as Zeek TSV logs:</p>\n<pre><code>parse zeek-tsv\n</code></pre>\n<p>Parse the input bytes as Suricata Eve JSON:</p>\n<pre><code>parse suricata\n</code></pre>',
  },
  {
    label: "pass",
    type: "keyword",
    detail: "Does nothing with the input.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>pass\n</code></pre>\n<h2>Description</h2>\n<p>The <code>pass</code> operator relays the input without any modification. It exists\nprimarily for testing and debugging.</p>\n<p>You can think of <code>pass</code> as the "identity" operator.</p>\n<h2>Examples</h2>\n<p>Forward the input without any changes:</p>\n<pre><code>pass\n</code></pre>',
  },
  {
    label: "print",
    type: "keyword",
    detail: "The `print` operator converts raw bytes into events.",
    processedHTML:
      '<p>:::warning Expert Operator\nThe <code>print</code> operator is a lower-level building block of the\n<a href="../sinks/to.md"><code>to</code></a> and <a href="../sinks/write.md"><code>write</code></a> operators. Only use this\nif you need to operate on the raw bytes themselves.\n:::</p>\n<h2>Synopsis</h2>\n<pre><code>print &#x3C;format>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>print</code> operator prints events and outputs the formatted result as raw\nbytes.</p>\n<h3><code>&#x3C;format></code></h3>\n<p>The <a href="../../formats.md">format</a> used to convert events into raw bytes.</p>\n<p>Some formats have format-specific options. Please refer to the documentation of\nthe individual formats for more information.</p>\n<h2>Examples</h2>\n<p>Convert events into JSON:</p>\n<pre><code>print json\n</code></pre>\n<p>Convert events into CSV:</p>\n<pre><code>print csv\n</code></pre>',
  },
  {
    label: "pseudonymize",
    type: "keyword",
    detail: "Pseudonymizes fields according to a given method.",
    processedHTML:
      '<p>:::warning Deprecated\nThis operator will soon be removed in favor of first-class support for functions\nthat can be used in a variety of different operators and contexts.\n:::</p>\n<h2>Synopsis</h2>\n<pre><code>pseudonymize -m|--method=&#x3C;string> -s|--seed=&#x3C;seed> &#x3C;extractor>...\n</code></pre>\n<h2>Description</h2>\n<p>The <code>pseudonimize</code> operator replaces IP address using the\n<a href="https://en.wikipedia.org/wiki/Crypto-PAn">Crypto-PAn</a> algorithm.</p>\n<p>Currently, <code>pseudonimize</code> exclusively works for fields of type <code>ip</code>.</p>\n<h3><code>-m|--method=&#x3C;string></code></h3>\n<p>The algorithm for pseudonimization</p>\n<h3><code>-s|--seed=&#x3C;seed></code></h3>\n<p>A 64-byte seed that describes a hexadecimal value. When the seed is shorter than\n64 bytes, the operator will append zeros to match the size; when it is longer,\nit will truncate the seed.</p>\n<h3><code>&#x3C;extractor>...</code></h3>\n<p>The list of extractors describing fields to pseudonomize. If an extractor\nmatches types other than IP addresses, the operator will ignore them.</p>\n<h2>Example</h2>\n<p>Pseudonymize all values of the fields <code>src_ip</code> and <code>dest_ip</code> using the\n<code>crypto-pan</code> algorithm and <code>deadbeef</code> seed:</p>\n<pre><code>pseudonymize --method="crypto-pan" --seed="deadbeef" src_ip, dest_ip\n</code></pre>',
  },
  {
    label: "put",
    type: "keyword",
    detail: "Returns new events that only contain a set of specified fields.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>put &#x3C;field[=operand]>...\n</code></pre>\n<h2>Description</h2>\n<p>The <code>put</code> operator produces new events according to a specified list of fields.\nAll other fields are removed from the input.</p>\n<p>The difference between <code>put</code> and <a href="extend.md"><code>extend</code></a> is that <code>put</code> drops all\nfields not explicitly specified, whereas <code>extend</code> only appends fields.</p>\n<h3><code>&#x3C;field[=operand]></code></h3>\n<p>The <code>field</code> describes the name of the field to select. The extended form with an\n<code>operand</code> assignment allows for computing functions over existing fields.</p>\n<p>If the right-hand side of the assignment\nis omitted, the field name is implicitly used as an extractor. If multiple\nfields match the extractor, the first matching field is used in the output. If\nno fields match, <code>null</code> is assigned instead.</p>\n<h3>Examples</h3>\n<p>Overwrite values of the field <code>payload</code> with a fixed value:</p>\n<pre><code class="language-c">put payload="REDACTED"\n</code></pre>\n<p>Create connection 4-tuples:</p>\n<pre><code class="language-c">put src_ip, src_port, dst_ip, dst_port\n</code></pre>\n<p>Unlike <a href="select.md"><code>select</code></a>, <code>put</code> reorders fields. If the specified fields\ndo not exist in the input, <code>null</code> values will be assigned.</p>\n<p>You can also reference existing fields:</p>\n<pre><code class="language-c">put src_ip, src_port, dst_ip=dest_ip, dst_port=dest_port\n</code></pre>',
  },
  {
    label: "rare",
    type: "keyword",
    detail: "Shows the least common values. The dual to [`top`](top.md).",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>rare &#x3C;field> [--count-field=&#x3C;count-field>|-c &#x3C;count-field>]\n</code></pre>\n<h2>Description</h2>\n<p>Shows the least common values for a given field. For each unique value, a new event containing its count will be produced.</p>\n<h3><code>&#x3C;field></code></h3>\n<p>The name of the field to find the least common values for.</p>\n<h3><code>--count-field=&#x3C;count-field>|-c &#x3C;count-field></code></h3>\n<p>An optional argument specifying the field name of the count field. Defaults to <code>count</code>.</p>\n<p>The count field and the value field must have different names.</p>\n<h2>Examples</h2>\n<p>Find the least common values for field <code>id.orig_h</code>.</p>\n<pre><code>rare id.orig_h\n</code></pre>\n<p>Find the least common values for field <code>count</code> and present the value amount in a field <code>amount</code>.</p>\n<pre><code>rare count --count-field=amount\n</code></pre>",
  },
  {
    label: "rename",
    type: "keyword",
    detail: "Renames fields and types.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>rename &#x3C;name=extractor>...\n</code></pre>\n<h2>Description</h2>\n<p>The <code>rename</code> operator assigns new names to fields or types. Renaming only\nmodifies metadata and is therefore computationally inexpensive. The operator\nhandles nested field extractors as well, but cannot perform field reordering,\ne.g., by hoisting nested fields into the top level.</p>\n<p>Renaming only takes place if the provided extractor on the right-hand side of\nthe assignment resolves to a field or type. Otherwise the assignment does\nnothing. If no extractors match, <code>rename</code> degenerates to <a href="pass.md"><code>pass</code></a>.</p>\n<h3><code>&#x3C;name=extractor>...</code></h3>\n<p>An assignment of the form <code>name=extractor</code> renames the field or type identified\nby <code>extractor</code> to <code>name</code>.</p>\n<h2>Examples</h2>\n<p>Rename events of type <code>suricata.flow</code> to <code>connection</code>:</p>\n<pre><code>rename connection=:suricata.flow\n</code></pre>\n<p>Assign new names to the fields <code>src_ip</code> and <code>dest_ip</code>:</p>\n<pre><code>rename src=src_ip, dst=dest_ip\n</code></pre>\n<p>Give the nested field <code>orig_h</code> nested under the record <code>id</code> the name <code>src_ip</code>:</p>\n<pre><code>rename src=id.orig_h\n</code></pre>\n<p>Same as above, but consider fields at any nesting hierarchy:</p>\n<pre><code>rename src=orig_h\n</code></pre>',
  },
  {
    label: "repeat",
    type: "keyword",
    detail: "Repeats the input a number of times.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>repeat [&#x3C;repetitions>]\n</code></pre>\n<h2>Description</h2>\n<p>The <code>repeat</code> operator relays the input without any modification, and repeats its\ninputs a specified number of times. It is primarily used for testing and when\nworking with generated data.</p>\n<p>The repeat operator keeps its input in memory. Avoid using it to repeat large\ndata sets.</p>\n<h3><code>&#x3C;repetitions></code></h3>\n<p>The number of times to repeat the input data.</p>\n<p>If not specified, the operator repeats its input indefinitely.</p>\n<h2>Examples</h2>\n<p>Given the following events as JSON:</p>\n<pre><code class="language-json">{"number": 1, "text": "one"}\n{"number": 2, "text": "two"}\n</code></pre>\n<p>The <code>repeat</code> operator will repeat them indefinitely, in order:</p>\n<pre><code>repeat\n</code></pre>\n<pre><code class="language-json">{"number": 1, "text": "one"}\n{"number": 2, "text": "two"}\n{"number": 1, "text": "one"}\n{"number": 2, "text": "two"}\n{"number": 1, "text": "one"}\n{"number": 2, "text": "two"}\n// …\n</code></pre>\n<p>To just repeat the first event 5 times, use:</p>\n<pre><code>head 1 | repeat 5\n</code></pre>\n<pre><code class="language-json">{"number": 1, "text": "one"}\n{"number": 1, "text": "one"}\n{"number": 1, "text": "one"}\n{"number": 1, "text": "one"}\n{"number": 1, "text": "one"}\n</code></pre>',
  },
  {
    label: "replace",
    type: "keyword",
    detail:
      "Replaces the fields matching the given extractors with fixed values.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>replace &#x3C;extractor=operand>...\n</code></pre>\n<h2>Description</h2>\n<p>The <code>replace</code> operator mutates existing fields by providing a new value.</p>\n<p>The difference between <code>replace</code> and <a href="extend.md"><code>extend</code></a> is that <code>replace</code>\noverwrites existing fields, whereas <code>extend</code> doesn\'t touch the input.</p>\n<h3><code>&#x3C;extractor=operand></code></h3>\n<p>The assignment consists of an <code>extractor</code> that matches against existing fields\nand an <code>operand</code> that defines the new field value.</p>\n<p>If <code>field</code> does not exist in the input, the operator degenerates to\n<a href="pass.md"><code>pass</code></a>.</p>\n<h3>Examples</h3>\n<p>Replace the field the field <code>src_ip</code> with a fixed value:</p>\n<pre><code>replace src_ip=0.0.0.0\n</code></pre>\n<p>Replace all IP address with a fixed value:</p>\n<pre><code>replace :ip=0.0.0.0\n</code></pre>',
  },
  {
    label: "select",
    type: "keyword",
    detail: "Selects fields from the input. The dual to [`drop`](drop.md).",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>select &#x3C;extractor>...\n</code></pre>\n<h2>Description</h2>\n<p>The <code>select</code> operator keeps only the fields matching the provided extractors and\nremoves all other fields.</p>\n<p>In relational algebra, <code>select</code> performs a <em>projection</em> of the provided\narguments.</p>\n<h3><code>&#x3C;extractor>...</code></h3>\n<p>The list of extractors identifying fields to keep.</p>\n<h2>Examples</h2>\n<p>Only keep fields <code>foo</code> and <code>bar</code>:</p>\n<pre><code>select foo, bar\n</code></pre>\n<p>Select all fields of type <code>ip</code>:</p>\n<pre><code>select :ip\n</code></pre>",
  },
  {
    label: "shell",
    type: "keyword",
    detail:
      "Executes a system command and hooks its raw stdin and stdout into the pipeline.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>shell &#x3C;command>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>shell</code> operator forks the process and executes the provided command.\nThereafter, it connects the child\'s stdin to the operator\'s input, and the\nchild\'s stdout to the operator\'s output. When <code>shell</code> receive new bytes as\ninput, it writes them to the child\'s standard input. In parallel, <code>shell</code>\nattempts to read from the child\'s stdout and copies new bytes into the operator\noutput.</p>\n<p>You can also use <a href="../sources/shell.md"><code>shell</code> as source operator</a> if you want\nto ignore stdin.</p>\n<h3><code>&#x3C;command></code></h3>\n<p>The command to execute and hook into the pipeline processing.</p>\n<p>The value of <code>command</code> is a single string. If you would like to pass a command\nline as you would on the shell, use single or double quotes for escaping, e.g.,\n<code>shell \'jq -C\'</code> or <code>shell "jq -C"</code>.</p>\n<h2>Examples</h2>\n<p>Consider the use case of converting CSV to JSON:</p>\n<pre><code class="language-bash">tenzir \'read csv | write json\' | jq -C\n</code></pre>\n<p>The <code>write json</code> operator produces NDJSON. Piping this output to <code>jq</code> generates a\ncolored, tree-structured variation that is (arguably) easier to read. Using the\n<code>shell</code> operator, you can integrate Unix tools that rely on\nstdin/stdout for input/output as "native" operators that process raw bytes. For\nexample, in this pipeline:</p>\n<pre><code>print json | save stdout\n</code></pre>\n<p>The <a href="../transformations/print.md"><code>print</code></a> operator produces raw bytes and\n<a href="../sinks/save.md"><code>save</code></a> accepts raw bytes. The <code>shell</code> operator therefore\nfits right in the middle:</p>\n<pre><code>print json | shell "jq -C" | save stdout\n</code></pre>\n<p>Using <a href="../user-defined.md">user-defined operators</a>, we can expose this\n(potentially verbose) post-processing more succinctly in the pipeline language:</p>\n<pre><code class="language-yaml">tenzir:\n  operators:\n    jsonize: >\n      print json | shell "jq -C" | save stdout\n</code></pre>\n<p>Now you can use <code>jsonize</code> as a custom operator in a pipeline:</p>\n<pre><code class="language-bash">tenzir \'read csv | where field > 42 | jsonize\' &#x3C; file.csv\n</code></pre>\n<p>This mechanism allows for wrapping also more complex invocation of tools.\n<a href="https://zeek.org">Zeek</a>, for example, converts packets into structured network\nlogs. Tenzir already has support for consuming Zeek output with the formats\n<a href="../../formats/zeek-json.md"><code>zeek-json</code></a> and\n<a href="../../formats/zeek-tsv.md"><code>zeek-tsv</code></a>. But that requires attaching yourself\ndownstream of a Zeek instance. Sometimes you want instant Zeek analytics given a\nPCAP trace.</p>\n<p>With the <code>shell</code> operator, you can script a Zeek invocation and readily\npost-process the output with a rich set of operators, to filter, reshape,\nenrich, or route the logs as structured data. Let\'s define a <code>zeek</code> operator for\nthat:</p>\n<pre><code class="language-yaml">tenzir:\n  operators:\n    zeek: >\n      shell "zeek -r - LogAscii::output_to_stdout=T\n             JSONStreaming::disable_default_logs=T\n             JSONStreaming::enable_log_rotation=F\n             json-streaming-logs"\n      | parse zeek-json\n</code></pre>\n<p>Processing a PCAP trace now is a matter of calling the <code>zeek</code> operator:</p>\n<pre><code class="language-bash">gunzip -c example.pcap.gz |\n  tenzir \'zeek | select id.orig_h, id.orig_p, id.resp_h | head 3\'\n</code></pre>\n<pre><code class="language-json">{"id": {"orig_h": null, "resp_h": null, "resp_p": null}}\n{"id": {"orig_h": "192.168.168.100", "resp_h": "83.135.95.78", "resp_p": 0}}\n{"id": {"orig_h": "192.168.168.100", "resp_h": "83.135.95.78", "resp_p": 22}}\n</code></pre>\n<p>NB: because <code>zeek</code> (= <code>shell</code>) reads bytes, we can drop the implicit <code>load stdin</code> source operator in this pipeline.</p>',
  },
  {
    label: "sigma",
    type: "keyword",
    detail:
      "Filter the input with [Sigma rules][sigma] and output matching events.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>sigma &#x3C;rule.yaml>\nsigma &#x3C;directory>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>sigma</code> operator executes <a href="https://github.com/SigmaHQ/sigma">Sigma rules</a> on\nits input. If a rule matches, the operator emits a <code>tenzir.sighting</code> event that\nwraps the input record into a new record along with the matching rule. The\noperator discards all events that do not match the provided rules.</p>\n<p>For each rule, the operator transpiles the YAML into an\n<a href="../../language/expressions.md">expression</a> and instantiates a\n<a href="where.md"><code>where</code></a> operator, followed by <a href="put.md"><code>put</code></a> to generate an output.\nHere\'s how the transpilation works. The Sigma rule YAML format requires a\n<code>detection</code> attribute that includes a map of named sub-expression called <em>search\nidentifiers</em>. In addition, <code>detection</code> must include a final <code>condition</code> that\ncombines search identifiers using boolean algebra (AND, OR, and NOT) or\nsyntactic sugar to reference groups of search expressions, e.g., using the\n<code>1/all of *</code> or plain wildcard syntax. Consider the following <code>detection</code>\nembedded in a rule:</p>\n<pre><code class="language-yaml">detection:\n  foo:\n    a: 42\n    b: "evil"\n  bar:\n    c: 1.2.3.4\n  condition: foo or not bar\n</code></pre>\n<p>We translate this rule piece by building a symbol table of all keys (<code>foo</code> and\n<code>bar</code>). Each sub-expression is a valid expression in itself:</p>\n<ol>\n<li><code>foo</code>: <code>a == 42 &#x26;&#x26; b == "evil"</code></li>\n<li><code>bar</code>: <code>c == 1.2.3.4</code></li>\n</ol>\n<p>Finally, we combine the expression according to <code>condition</code>:</p>\n<pre><code class="language-c">(a == 42 &#x26;&#x26; b == "evil") || ! (c == 1.2.3.4)\n</code></pre>\n<p>We parse the YAML string values according to Tenzir\'s richer data model, e.g.,\nthe expression <code>c: 1.2.3.4</code> becomes a field named <code>c</code> and value <code>1.2.3.4</code> of\ntype <code>ip</code>, rather than a <code>string</code>. Sigma also comes with its own <a href="https://github.com/SigmaHQ/sigma-specification/blob/main/Taxonomy_specification.md">event\ntaxonomy</a>\nto standardize field names. The <code>sigma</code> operator currently does not normalize\nfields according to this taxonomy but rather takes the field names verbatim from\nthe search identifier.</p>\n<p>Sigma uses <a href="https://github.com/SigmaHQ/sigma-specification/blob/main/Sigma_specification.md#value-modifiers">value\nmodifiers</a>\nto select a concrete relational operator for given search predicate. Without a\nmodifier, Sigma uses equality comparison (<code>==</code>) of field and value. For example,\nthe <code>contains</code> modifier changes the relational operator to substring search, and\nthe <code>re</code> modifier switches to a regular expression match. The table below shows\nwhat modifiers the <code>sigma</code> operator supports, where ✅ means implemented, 🚧 not\nyet implemented but possible, and ❌ not yet supported:</p>\n<p>|Modifier|Use|sigmac|Tenzir|\n|--------|---|:----:|:--:|\n|<code>contains</code>|perform a substring search with the value|✅|✅|\n|<code>startswith</code>|match the value as a prefix|✅|✅|\n|<code>endswith</code>|match the value as a suffix|✅|✅|\n|<code>base64</code>|encode the value with Base64|✅|✅\n|<code>base64offset</code>|encode value as all three possible Base64 variants|✅|✅\n|<code>utf16le</code>/<code>wide</code>|transform the value to UTF16 little endian|✅|🚧\n|<code>utf16be</code>|transform the value to UTF16 big endian|✅|🚧\n|<code>utf16</code>|transform the value to UTF16|✅|🚧\n|<code>re</code>|interpret the value as regular expression|✅|✅\n|<code>cidr</code>|interpret the value as a IP CIDR|❌|✅\n|<code>all</code>|changes the expression logic from OR to AND|✅|✅\n|<code>lt</code>|compare less than (<code>&#x3C;</code>) the value|❌|✅\n|<code>lte</code>|compare less than or equal to (<code>&#x3C;=</code>) the value|❌|✅\n|<code>gt</code>|compare greater than (<code>></code>) the value|❌|✅\n|<code>gte</code>|compare greater than or equal to (<code>>=</code>) the value|❌|✅\n|<code>expand</code>|expand value to placeholder strings, e.g., <code>%something%</code>|❌|❌</p>\n<h3><code>&#x3C;rule.yaml></code></h3>\n<p>The rule to match.</p>\n<p>This invocation transpiles <code>rule.yaml</code> at the time of pipeline creation.</p>\n<h3><code>&#x3C;directory></code></h3>\n<p>The directory to watch.</p>\n<p>This invocation watches a directory and attempts to parse each contained file as\na Sigma rule. The <code>sigma</code> operator matches if <em>any</em> of the contained rules\nmatch, effectively creating a disjunction of all rules inside the directory.</p>\n<h2>Examples</h2>\n<p>Apply a Sigma rule to an EVTX file using\n<a href="https://github.com/omerbenamram/evtx"><code>evtx_dump</code></a>:</p>\n<pre><code class="language-bash">evtx_dump -o jsonl file.evtx | tenzir \'read json | sigma rule.yaml\'\n</code></pre>\n<p>Apply a Sigma rule over historical data in a node from the last day:</p>\n<pre><code>export | where :timestamp > 1 day ago | sigma rule.yaml\n</code></pre>\n<p>Watch a directory of Sigma rules and apply all of them on a continuous stream of\nSuricata events:</p>\n<pre><code>from file --follow read suricata | sigma /tmp/rules/\n</code></pre>\n<p>When you add a new file to <code>/tmp/rules</code>, the <code>sigma</code> operator transpiles it and\nwill match it on all subsequent inputs.</p>',
  },
  {
    label: "sort",
    type: "keyword",
    detail: "Sorts events.",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>sort &#x3C;field> [&#x3C;asc>|&#x3C;desc>] [&#x3C;nulls-first>|&#x3C;nulls-last>]\n</code></pre>\n<h2>Description</h2>\n<p>Sorts events by a provided field.</p>\n<p>:::caution Work in Progress\nThe implementation of the <code>sort</code> operator currently only works with field names.\nWe plan to support sorting by meta data, and more generally, entire expressions.\nTo date, the operator also lacks support for all data types. Unsupported are\ncurrently compound and extension types (<code>ip</code>, <code>subnet</code>, <code>enum</code>).\n:::</p>\n<h3><code>&#x3C;field></code></h3>\n<p>The name of the field to sort by.</p>\n<h3><code>&#x3C;asc>|&#x3C;desc></code></h3>\n<p>Specifies the sort order.</p>\n<p>Defaults to <code>asc</code>.</p>\n<h3><code>&#x3C;nulls-first>|&#x3C;nulls-last></code></h3>\n<p>Specifies how to order null values.</p>\n<p>Defaults to <code>nulls-last</code>.</p>\n<h2>Examples</h2>\n<p>Sort by the <code>timestamp</code> field in ascending order.</p>\n<pre><code>sort timestamp\n</code></pre>\n<p>Sort by the <code>timestamp</code> field in descending order.</p>\n<pre><code>sort timestamp desc\n</code></pre>\n<p>Arrange by field <code>foo</code> and put null values first:</p>\n<pre><code>sort foo nulls-first\n</code></pre>\n<p>Arrange by field <code>foo</code> in descending order and put null values first:</p>\n<pre><code>sort foo desc nulls-first\n</code></pre>",
  },
  {
    label: "summarize",
    type: "keyword",
    detail: "Groups events and applies aggregate functions on each group.",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>summarize &#x3C;[field=]aggregation>... [by &#x3C;extractor>... [resolution &#x3C;duration>]]\n</code></pre>\n<h2>Description</h2>\n<p>The <code>summarize</code> operator groups events according to a grouping expression and\napplies an aggregation function over each group. The operator consumes the\nentire input before producing an output.</p>\n<p>Fields that neither occur in an aggregation function nor in the <code>by</code> list\nare dropped from the output.</p>\n<h3><code>[field=]aggregation</code></h3>\n<p>Aggregation functions compute a single value of one or more columns in a given\ngroup. Syntactically, <code>aggregation</code> has the form <code>f(x)</code> where <code>f</code> is the\naggregation function and <code>x</code> is a field.</p>\n<p>By default, the name for the new field <code>aggregation</code> is its string\nrepresentation, e.g., <code>min(timestamp)</code>. You can specify a different name by\nprepending a field assignment, e.g., <code>min_ts=min(timestamp)</code>.</p>\n<p>The following aggregation functions are available:</p>\n<ul>\n<li><code>sum</code>: Computes the sum of all grouped values.</li>\n<li><code>min</code>: Computes the minimum of all grouped values.</li>\n<li><code>max</code>: Computes the maximum of all grouped values.</li>\n<li><code>any</code>: Computes the disjunction (OR) of all grouped values. Requires the\nvalues to be booleans.</li>\n<li><code>all</code>: Computes the conjunction (AND) of all grouped values. Requires the\nvalues to be booleans.</li>\n<li><code>distinct</code>: Creates a sorted list of all unique grouped values that are not\nnull.</li>\n<li><code>sample</code>: Takes the first of all grouped values that is not null.</li>\n<li><code>count</code>: Counts all grouped values that are not null.</li>\n<li><code>count_distinct</code>: Counts all distinct grouped values that are not null.</li>\n</ul>\n<h3><code>by &#x3C;extractor></code></h3>\n<p>The extractors specified after the optional <code>by</code> clause partition the input into\ngroups. If <code>by</code> is omitted, all events are assigned to the same group.</p>\n<h3><code>resolution &#x3C;duration></code></h3>\n<p>The <code>resolution</code> option specifies an optional duration value that specifies the\ntolerance when comparing time values in the <code>group-by</code> section. For example,\n<code>01:48</code> is rounded down to <code>01:00</code> when a 1-hour <code>resolution</code> is used.</p>\n<p>NB: we introduced the <code>resolution</code> option as a stop-gap measure to compensate for\nthe lack of a rounding function. The ability to apply functions in the grouping\nexpression will replace this option in the future.</p>\n<h2>Examples</h2>\n<p>Group the input by <code>src_ip</code> and aggregate all unique <code>dest_port</code> values into a\nlist:</p>\n<pre><code>summarize distinct(dest_port) by src_ip\n</code></pre>\n<p>Same as above, but produce a count of the unique number of values instead of a\nlist:</p>\n<pre><code>summarize count_distinct(dest_port) by src_ip\n</code></pre>\n<p>Compute minimum, maximum of the <code>timestamp</code> field per <code>src_ip</code> group:</p>\n<pre><code>summarize min(timestamp), max(timestamp) by src_ip\n</code></pre>\n<p>Compute minimum, maximum of the <code>timestamp</code> field over all events:</p>\n<pre><code>summarize min(timestamp), max(timestamp)\n</code></pre>\n<p>Create a boolean flag <code>originator</code> that is <code>true</code> if any value in the group is\n<code>true</code>:</p>\n<pre><code>summarize originator=any(is_orig) by src_ip\n</code></pre>\n<p>Create 1-hour groups and produce a summary of network traffic between host\npairs:</p>\n<pre><code>summarize sum(bytes_in), sum(bytes_out) by src_ip, dest_ip resolution 1 hour\n</code></pre>",
  },
  {
    label: "tail",
    type: "keyword",
    detail: "Limits the input to the last *N* events.",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>tail [&#x3C;limit>]\n</code></pre>\n<h2>Description</h2>\n<p>The semantics of the <code>tail</code> operator are the same of the equivalent Unix tool:\nconsume all input and only display the last <em>N</em> events.</p>\n<h3><code>&#x3C;limit></code></h3>\n<p>An unsigned integer denoting how many events to keep. Defaults to 10.</p>\n<p>Defaults to 10.</p>\n<h2>Examples</h2>\n<p>Get the last ten results:</p>\n<pre><code>tail\n</code></pre>\n<p>Get the last five results:</p>\n<pre><code>tail 5\n</code></pre>",
  },
  {
    label: "taste",
    type: "keyword",
    detail: "Limits the input to the first *N* events per unique schema.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>taste [&#x3C;limit>]\n</code></pre>\n<h2>Description</h2>\n<p>The <code>taste</code> operator provides an exemplary overview of the "shape" of the data\ndescribed by the pipeline. This helps to understand the diversity of the\nresult, especially when interactively exploring data.</p>\n<h3><code>&#x3C;limit></code></h3>\n<p>An unsigned integer denoting how many events to keep per schema.</p>\n<p>Defaults to 10.</p>\n<h2>Examples</h2>\n<p>Get the first 10 results of each unique schema:</p>\n<pre><code>taste\n</code></pre>\n<p>Get the one sample for every unique event type:</p>\n<pre><code>taste 1\n</code></pre>',
  },
  {
    label: "top",
    type: "keyword",
    detail: "Shows the most common values. The dual to [`rare`](rare.md).",
    processedHTML:
      "<h2>Synopsis</h2>\n<pre><code>top &#x3C;field> [--count-field=&#x3C;count-field>|-c &#x3C;count-field>]\n</code></pre>\n<h2>Description</h2>\n<p>Shows the most common values for a given field. For each unique value, a new event containing its count will be produced.</p>\n<h3><code>&#x3C;field></code></h3>\n<p>The name of the field to find the most common values for.</p>\n<h3><code>--count-field=&#x3C;count-field>|-c &#x3C;count-field></code></h3>\n<p>An optional argument specifying the field name of the count field. Defaults to <code>count</code>.</p>\n<p>The count field and the value field must have different names.</p>\n<h2>Examples</h2>\n<p>Find the most common values for field <code>id.orig_h</code>.</p>\n<pre><code>top id.orig_h\n</code></pre>\n<p>Find the most common values for field <code>count</code> and present the value amount in a field <code>amount</code>.</p>\n<pre><code>top count --count-field=amount\n</code></pre>",
  },
  {
    label: "unique",
    type: "keyword",
    detail: "Removes adjacent duplicates.",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>unique\n</code></pre>\n<h2>Description</h2>\n<p>The <code>unique</code> operator deduplicates adjacent values, similar to the Unix tool\n<code>uniq</code>.</p>\n<p>A frequent use case is <a href="select.md">selecting a set of fields</a>, <a href="sort.md">sorting the\ninput</a>, and then removing duplicates from the input.</p>\n<h2>Examples</h2>\n<p>Consider the following data:</p>\n<pre><code class="language-json">{"foo": 1, "bar": "a"}\n{"foo": 1, "bar": "a"}\n{"foo": 1, "bar": "a"}\n{"foo": 1, "bar": "b"}\n{"foo": null, "bar": "b"}\n{"bar": "b"}\n{"foo": null, "bar": "b"}\n{"foo": null, "bar": "b"}\n</code></pre>\n<p>The <code>unique</code> operator removes adjacent duplicates and produces the following output:</p>\n<pre><code class="language-json">{"foo": 1, "bar": "a"}\n{"foo": 1, "bar": "b"}\n{"foo": null, "bar": "b"}\n{"bar": "b"}\n{"foo": null, "bar": "b"}\n</code></pre>\n<p>Note that the output still contains the event <code>{"foo": null, "bar": "b"}</code> twice.\nThis is because <code>unique</code> only removes <em>adjacent</em> duplicates.</p>\n<p>To remove <em>all</em> duplicates (including non-adjacent ones), <a href="sort.md"><code>sort</code></a>\nthe input first such that duplicate values lay adjacent to each other. Unlike\ndeduplication via <code>unique</code>, sorting is a blocking and operation and consumes\nthe entire input before producing outputs.</p>',
  },
  {
    label: "where",
    type: "keyword",
    detail:
      "Filters events according to an [expression](../../language/expressions.md).",
    processedHTML:
      '<h2>Synopsis</h2>\n<pre><code>where &#x3C;expression>\n</code></pre>\n<h2>Description</h2>\n<p>The <code>where</code> operator only keeps events that match the provided\n<a href="../../language/expressions.md">expression</a> and discards all other events.</p>\n<p>Use <code>where</code> to extract the subset of interest of the data. Tenzir\'s expression\nlanguage offers various ways to describe the desired data. In particular,\nexpressions work <em>across schemas</em> and thus make it easy to concisely articulate\nconstraints.</p>\n<h3><code>&#x3C;expression></code></h3>\n<p>The <a href="../../language/expressions.md">expression</a> to evaluate for each event.</p>\n<h2>Examples</h2>\n<p>Select all events that contain a field with the value <code>1.2.3.4</code>:</p>\n<pre><code>where 1.2.3.4\n</code></pre>\n<p>This expression internally completes to <code>:ip == 1.2.3.4</code>. The type extractor\n<code>:ip</code> describes all fields of type <code>ip</code>. Use field extractors to only consider a\nsingle field:</p>\n<pre><code>where src_ip == 1.2.3.4\n</code></pre>\n<p>As a slight variation of the above: use a nested field name and a temporal\nconstraint of the field with name <code>ts</code>:</p>\n<pre><code>where id.orig_h == 1.2.3.4 &#x26;&#x26; ts > 1 hour ago\n</code></pre>\n<p>Subnets are first-class values:</p>\n<pre><code>where 10.10.5.0/25\n</code></pre>\n<p>This expression unfolds to <code>:ip in 10.10.5.0/25 || :subnet == 10.10.5.0/25</code>. It\nmeans "select all events that contain a field of type <code>ip</code> in the subnet\n<code>10.10.5.0/25</code>, or a field of type <code>subnet</code> the exactly matches <code>10.10.5.0/25</code>".</p>\n<p>Expressions consist of predicates that can be connected with AND, OR, and NOT:</p>\n<pre><code>where 10.10.5.0/25 &#x26;&#x26; (orig_bytes > 1 Mi || duration > 30 min)\n</code></pre>',
  },
];

export const TenzirQueryLang = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        Int64: t.integer,
        UInt64: t.integer,
        Ip: t.atom,

        None: t.null,
        Comparison: t.compareOperator,
        "|| &&": t.logicOperator,
        true: t.bool,
        false: t.bool,

        Field: t.variableName,
        LineComment: t.comment,
        "|": t.operatorKeyword,

        Head: t.keyword,
        Where: t.keyword,
        Pass: t.keyword,
        Drop: t.keyword,
      }),
    ],
    // TODO: add folding later
  }),
});

type GeneretedCompletion = {
  label: string;
  type: string;
  detail: string;
  processedHTML: string;
};

type Completion = {
  label: string;
  type: string;
  detail: string;
  info: () => Node;
};

const getCompletion = (completion: GeneretedCompletion): Completion => {
  return {
    label: completion.label,
    type: completion.type,
    detail: completion.detail,
    info: () => {
      const node = document.createElement("div");
      node.innerHTML = completion.processedHTML;
      return node;
    },
  };
};
// process the ../scripts/output.json file
const tqlCompletionList = data.map((completion: GeneretedCompletion) =>
  getCompletion(completion)
);

export const tqlCompletion = TenzirQueryLang.data.of({
  autocomplete: completeFromList(tqlCompletionList),
});

export function TQL() {
  return new LanguageSupport(TenzirQueryLang, [tqlCompletion]);
}
