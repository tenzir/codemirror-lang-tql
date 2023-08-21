import { visit } from "unist-util-visit";
import { h } from "hastscript";

const admonitions = ["note", "tip", "info", "danger", "caution"];

/** @type {import('unified').Plugin<[], import('mdast').Root>} */
export const remarkProcessAdmonitions = () => {
  return (tree) => {
    visit(tree, (node) => {
      if (
        node.type === "textDirective" ||
        node.type === "leafDirective" ||
        node.type === "containerDirective"
      ) {
        // process docusarus admonitions - https://v2.docusaurus.io/docs/markdown-features/#admonitions
        if (!admonitions.includes(node.name)) return;

        const data = node.data || (node.data = {});
        const tagName = node.type === "textDirective" ? "span" : "div";

        // Add 'admonition-{type}' className to hProperties
        const className = `admonition-${node.name}`;

        data.hName = tagName;
        data.hProperties = {
          ...h(tagName, node.attributes).properties,
          className,
        };
      }
    });
  };
};
