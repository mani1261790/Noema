import { processNextQueuedJobs } from "@/lib/qa";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Noema worker started.");

  while (true) {
    const processed = await processNextQueuedJobs(5);
    if (processed === 0) {
      await sleep(2000);
      continue;
    }
    await sleep(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
