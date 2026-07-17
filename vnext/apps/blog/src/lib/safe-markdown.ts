import { isSafeArticleMarkdownUrl } from "@noema/content";
import { defineHastPlugin, defineMdastPlugin } from "satteri";

export const articleMarkdownFeatures = {
  smartPunctuation: false,
} as const;

export const hardenArticleMarkdown = defineMdastPlugin({
  name: "noema-harden-article-markdown",
  html(node, context) {
    context.replaceNode(node, { type: "text", value: node.value });
  },
  link(node, context) {
    if (!isSafeArticleMarkdownUrl(node.url, "link")) {
      context.setProperty(node, "url", "#");
    }
  },
  image(node, context) {
    if (!isSafeArticleMarkdownUrl(node.url, "image")) {
      context.replaceNode(node, { type: "text", value: node.alt ?? "" });
    }
  },
  definition(node, context) {
    if (!isSafeArticleMarkdownUrl(node.url, "link")) {
      context.setProperty(node, "url", "#");
    }
  },
});

export const hardenArticleHtml = defineHastPlugin({
  name: "noema-harden-article-html",
  element: [
    {
      filter: ["a"],
      visit(node, context) {
        const href = node.properties?.href;
        if (
          typeof href === "string" &&
          !isSafeArticleMarkdownUrl(href, "link")
        ) {
          context.setProperty(node, "href", "#");
        }
      },
    },
    {
      filter: ["img"],
      visit(node, context) {
        const source = node.properties?.src;
        if (
          typeof source !== "string" ||
          isSafeArticleMarkdownUrl(source, "image")
        ) {
          return;
        }

        const alt = node.properties?.alt;
        context.replaceNode(node, {
          type: "text",
          value: typeof alt === "string" ? alt : "",
        });
      },
    },
  ],
});
