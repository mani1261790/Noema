declare module "markdown-it-katex" {
  import type MarkdownIt from "markdown-it";

  type KatexPlugin = (md: MarkdownIt) => void;

  const plugin: KatexPlugin;
  export default plugin;
}
