import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdownLanguage);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["js", "jsx", "ts", "tsx"], { languageName: "typescript" });

function highlightMarkdownCode(source: string, language: string): string {
  const normalizedLanguage = language.trim().toLowerCase();
  return hljs.highlight(source, {
    ignoreIllegals: true,
    language: normalizedLanguage && hljs.getLanguage(normalizedLanguage)
      ? normalizedLanguage
      : "plaintext"
  }).value;
}

export function resolvePublicSiteReference(reference: string, publicSiteUrl: string): string {
  const value = reference.trim();

  if (!value.startsWith("/") || value.startsWith("//")) return reference;

  try {
    return new URL(value, publicSiteUrl).href;
  } catch {
    return reference;
  }
}

export function resolvePreviewImageReference(reference: string, publicSiteUrl: string): string {
  if (reference.startsWith("/media/articles/")) {
    return `/api/cms/assets/${reference.slice("/media/".length)}`;
  }
  return resolvePublicSiteReference(reference, publicSiteUrl);
}

export function createPreviewMarkdown(publicSiteUrl: string): MarkdownIt {
  const markdown = new MarkdownIt({
    highlight: highlightMarkdownCode,
    html: false,
    linkify: true,
    typographer: true
  });
  const defaultImageRule = markdown.renderer.rules.image;

  if (!defaultImageRule) {
    throw new Error("MarkdownIt image renderer is unavailable");
  }

  markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const source = tokens[index].attrGet("src");

    if (source) {
      tokens[index].attrSet("src", resolvePreviewImageReference(source, publicSiteUrl));
    }

    return defaultImageRule(tokens, index, options, env, renderer);
  };

  const defaultLinkRule = markdown.renderer.rules.link_open;

  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const href = tokens[index].attrGet("href");

    if (href) {
      tokens[index].attrSet("href", resolvePublicSiteReference(href, publicSiteUrl));
      if (!href.startsWith("#")) {
        tokens[index].attrSet("target", "_blank");
        tokens[index].attrSet("rel", "noreferrer");
      }
    }

    return defaultLinkRule
      ? defaultLinkRule(tokens, index, options, env, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  return markdown;
}
