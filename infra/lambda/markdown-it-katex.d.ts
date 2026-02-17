declare module "markdown-it-katex" {
  import type MarkdownIt from "markdown-it";

  type KatexPluginOptions = {
    throwOnError?: boolean;
    errorColor?: string;
  };

  const plugin: (md: MarkdownIt, options?: KatexPluginOptions) => void;
  export default plugin;
}
