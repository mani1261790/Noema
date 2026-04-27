# Assessment Content

Noema assessments are authored one chapter at a time.

- `notebook-checks/{notebookId}.json`: 5 multiple-choice questions for a notebook. Passing requires 5/5.
- `chapter-finals/{chapterId}.json`: about 10 final questions for a chapter. Passing requires 90%.
- Notebook checks must include `correctChoiceId` for every question.
- Chapter finals are rubric-based and are graded question-by-question by the grading agent.
- Missing or invalid files should fail fast. Generic placeholder fallback assessments are no longer used.
