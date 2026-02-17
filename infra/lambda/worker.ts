import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { processQuestionById } from "./runtime";

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const parsed = JSON.parse(record.body || "{}") as { questionId?: string };
      const questionId = (parsed.questionId || "").trim();
      if (!questionId) {
        throw new Error("questionId is required in message body");
      }

      await processQuestionById(questionId);
    } catch (error) {
      console.error("Failed to process QA job", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error)
      });

      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
