import {
  forwardRef,
  useRef,
  type ComponentPropsWithoutRef,
  type UIEvent
} from "react";

type MarkdownEditorProps = Omit<ComponentPropsWithoutRef<"textarea">, "value"> & {
  value: string;
};

export const MarkdownEditor = forwardRef<HTMLTextAreaElement, MarkdownEditorProps>(
  function MarkdownEditor({ onScroll, value, ...props }, ref) {
    const gutter = useRef<HTMLDivElement>(null);
    const lineCount = value.split("\n").length;
    const lineNumbers = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");

    const syncLineNumbers = (event: UIEvent<HTMLTextAreaElement>) => {
      if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
      onScroll?.(event);
    };

    return (
      <div className="studio-markdown-editor">
        <div
          aria-hidden="true"
          className="studio-markdown-editor__line-numbers"
          ref={gutter}
        >
          {lineNumbers}
        </div>
        <textarea
          {...props}
          onScroll={syncLineNumbers}
          ref={ref}
          value={value}
          wrap="off"
        />
      </div>
    );
  }
);
