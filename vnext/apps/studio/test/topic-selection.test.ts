import { describe, expect, it } from "vitest";
import {
  isArticleTopicChoiceDisabled,
  toggleArticleTopic
} from "../src/topic-selection";

describe("toggleArticleTopic", () => {
  it("adds a topic without replacing the existing selections", () => {
    expect(toggleArticleTopic(
      ["conversational-ai", "mathematics"],
      "development-environment",
      true
    )).toEqual(["conversational-ai", "mathematics", "development-environment"]);
  });

  it("removes only the topic that was deselected", () => {
    expect(toggleArticleTopic(
      ["conversational-ai", "mathematics", "development-environment"],
      "mathematics",
      false
    )).toEqual(["conversational-ai", "development-environment"]);
  });

  it("does not duplicate an already selected topic", () => {
    expect(toggleArticleTopic(
      ["conversational-ai", "mathematics"],
      "mathematics",
      true
    )).toEqual(["conversational-ai", "mathematics"]);
  });

  it("does not add a fourth topic", () => {
    const topics = [
      "conversational-ai",
      "mathematics",
      "development-environment"
    ] as const;
    expect(toggleArticleTopic([...topics], "data-models", true)).toEqual(topics);
  });
});

describe("isArticleTopicChoiceDisabled", () => {
  it("disables only unchecked choices once three topics are selected", () => {
    const topics = ["conversational-ai", "mathematics", "development-environment"] as const;
    expect(isArticleTopicChoiceDisabled([...topics], "data-models")).toBe(true);
    expect(isArticleTopicChoiceDisabled([...topics], "mathematics")).toBe(false);
  });

  it("keeps selected choices enabled in legacy data with more than three topics", () => {
    const topics = [
      "conversational-ai",
      "mathematics",
      "development-environment",
      "data-models"
    ] as const;
    expect(isArticleTopicChoiceDisabled([...topics], "data-models")).toBe(false);
    expect(isArticleTopicChoiceDisabled([...topics], "generation-creation")).toBe(true);
    expect(toggleArticleTopic([...topics], "data-models", false)).toEqual([
      "conversational-ai",
      "mathematics",
      "development-environment"
    ]);
  });
});
