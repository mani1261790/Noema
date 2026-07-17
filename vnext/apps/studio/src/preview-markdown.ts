import MarkdownIt from "markdown-it";

export function resolvePublicSiteReference(reference: string, publicSiteUrl: string): string {
  const value = reference.trim();

  if (!value.startsWith("/") || value.startsWith("//")) return reference;

  try {
    return new URL(value, publicSiteUrl).href;
  } catch {
    return reference;
  }
}

export function createPreviewMarkdown(publicSiteUrl: string): MarkdownIt {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const defaultImageRule = markdown.renderer.rules.image;

  if (!defaultImageRule) {
    throw new Error("MarkdownIt image renderer is unavailable");
  }

  markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const source = tokens[index].attrGet("src");

    if (source) {
      tokens[index].attrSet("src", resolvePublicSiteReference(source, publicSiteUrl));
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
