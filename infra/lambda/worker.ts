import type { SQSHandler } from "aws-lambda";

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    console.log("Received QA job", {
      messageId: record.messageId,
      body: record.body
    });
  }
};
