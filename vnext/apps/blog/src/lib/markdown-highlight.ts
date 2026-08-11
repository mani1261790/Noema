import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["js", "jsx", "ts", "tsx"], { languageName: "typescript" });

export function highlightMarkdownCode(source: string, language: string): string {
  const normalizedLanguage = language.trim().toLowerCase();

  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    return hljs.highlight(source, {
      ignoreIllegals: true,
      language: normalizedLanguage
    }).value;
  }

  return hljs.highlight(source, { language: "plaintext" }).value;
}
