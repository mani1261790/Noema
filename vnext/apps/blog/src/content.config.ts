import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { articleFrontmatterSchema } from "@noema/content";

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: articleFrontmatterSchema
});

export const collections = { articles };
