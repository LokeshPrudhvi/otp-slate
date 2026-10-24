// Run after building the API: node --test tests/crt-starter-content.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { crtTopicInput } from "../apps/api/dist/crt.js";

const readData = (name) =>
  JSON.parse(
    readFileSync(new URL(`../data/crt/${name}.json`, import.meta.url), "utf8"),
  );
const syllabus = readData("campus-recruitment-aptitude-training");
const quantitativeReasoning = readData("starter-quantitative-reasoning");
const verbalSoftSkills = readData("starter-verbal-soft-skills");
const topics = [...quantitativeReasoning, ...verbalSoftSkills];
const topicKey = ({ subjectId, title }) => `${subjectId}:${title}`;

test("starter content covers the entire 72-topic syllabus exactly once", () => {
  assert.equal(topics.length, 72);
  assert.equal(quantitativeReasoning.length, 43);
  assert.equal(verbalSoftSkills.length, 29);
  assert.equal(new Set(topics.map(topicKey)).size, topics.length);
  assert.equal(
    new Set(topics.map((topic) => topic.topicId)).size,
    topics.length,
  );
  assert.deepEqual(
    topics.map(topicKey).sort(),
    syllabus.topics.map(topicKey).sort(),
  );
  const counts = topics.reduce((result, topic) => {
    result[topic.subjectId] = (result[topic.subjectId] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, {
    quantitative: 14,
    reasoning: 29,
    verbal: 15,
    "soft-skills": 14,
  });
});

test("all 144 MCQs are complete, have unique IDs and four distinct choices", () => {
  const ids = new Set();
  const prompts = new Set();
  for (const topic of topics) {
    assert.match(
      topic.topicId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      topic.title,
    );
    assert.equal(topic.questions.length, 2, topic.title);
    for (const question of topic.questions) {
      assert.ok(!ids.has(question.id), `Repeated question ID: ${question.id}`);
      ids.add(question.id);
      const prompt = question.prompt.normalize("NFKC").trim();
      assert.ok(prompt.length > 10, question.id);
      assert.ok(!prompts.has(prompt), `Repeated prompt: ${question.id}`);
      prompts.add(prompt);
      assert.equal(question.options.length, 4, question.id);
      const options = question.options.map((option) =>
        option.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
      );
      assert.ok(options.every(Boolean), question.id);
      assert.equal(new Set(options).size, 4, question.id);
      assert.ok(Number.isInteger(question.correctOption), question.id);
      assert.ok(
        question.correctOption >= 0 && question.correctOption < 4,
        question.id,
      );
      assert.ok(question.explanation.trim().length > 10, question.id);
    }
  }
  assert.equal(ids.size, 144);
});

test("every starter topic passes the real API CRT input schema", () => {
  for (const topic of topics) {
    const result = crtTopicInput.safeParse({
      title: topic.title,
      subjectId: topic.subjectId,
      description: "Starter assessment for this syllabus topic.",
      passingScore: syllabus.defaultPassingScore,
      questions: topic.questions,
    });
    assert.ok(result.success, `${topic.title}: ${result.error?.message ?? ""}`);
  }
});

const selected = (title, questionIndex) => {
  const topic = topics.find((candidate) => candidate.title === title);
  assert.ok(topic, `Missing topic: ${title}`);
  const question = topic.questions[questionIndex];
  return question.options[question.correctOption];
};
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const ratio = (a, b) => `${a / gcd(a, b)}:${b / gcd(a, b)}`;
const fraction = (a, b) => `${a / gcd(a, b)}/${b / gcd(a, b)}`;
const numericAnswer = (title, index) => {
  const value = selected(title, index)
    .replaceAll(",", "")
    .match(/\d+(?:\.\d+)?/);
  assert.ok(value, `No numeric answer for ${title}`);
  return Number(value[0]);
};

// These independently calculate the answers to the authored problems. They
// assert the selected option's value, rather than fixing the answer's position.
const arithmeticCases = [
  ["Averages", [(12 + 18 + 20 + 30) / 4, (5 * 18 + 30) / 6]],
  ["Basic Probability", [fraction(3, 3 + 2), fraction(2, 6)]],
  [
    "Data Interpretation (Tables, Bar Graphs and Pie Charts)",
    [((180 - 120) / 120) * 100, (90 / 360) * 200],
  ],
  [
    "Mixtures and Alligation",
    [((10 * 0.2) / 20) * 100, ratio(60 - 45, 45 - 40)],
  ],
  ["Number Series", [24 * 2, 17 + 9]],
  ["Number System and Simplification", [18 + (24 / 6) * 3, gcd(36, 48)]],
  ["Percentages", [240 * 0.2, 500 * 1.2]],
  ["Permutations and Combinations", [3 * 2 * 1, (5 * 4) / (2 * 1)]],
  ["Problems on Ages", [ratio(24 + 6, 12 + 6), (40 + 8) / 2]],
  ["Profit, Loss and Discounts", [((1000 - 800) / 800) * 100, 1500 * 0.8]],
  ["Ratio and Proportion", [(64 / (3 + 5)) * 3, (84 / 7) * 5]],
  ["Simple and Compound Interest", [5000 * 0.08 * 2, 1000 * 1.1 ** 2]],
  ["Time and Work", [1 / (1 / 6 + 1 / 12), (6 * 10) / 15]],
  ["Time, Speed and Distance", [150 / 3, 180 / ((72 * 1000) / 3600)]],
];

for (const [title, answers] of arithmeticCases) {
  test(`${title}: both selected answers match independent calculations`, () => {
    answers.forEach((expected, index) => {
      if (typeof expected === "string") {
        assert.equal(selected(title, index), expected);
      } else {
        assert.ok(
          Math.abs(numericAnswer(title, index) - expected) < 1e-9,
          `${title}, question ${index + 1}: expected ${expected}`,
        );
      }
    });
  });
}

test("quantitative calculation coverage includes every quantitative MCQ", () => {
  assert.deepEqual(
    arithmeticCases.map(([title]) => title).sort(),
    topics
      .filter((topic) => topic.subjectId === "quantitative")
      .map((topic) => topic.title)
      .sort(),
  );
  assert.equal(
    arithmeticCases.reduce((sum, [, answers]) => sum + answers.length, 0),
    28,
  );
});

const permutations = (items) =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_, i) => i !== index)).map((tail) => [
          item,
          ...tail,
        ]),
      );

test("logic puzzles and seating arrangements each have one valid solution", () => {
  const colors = permutations(["Red", "Blue", "Green"]).filter(
    ([a, b]) => a === "Red" && b !== "Blue",
  );
  assert.equal(colors.length, 1);
  assert.equal(selected("Logical Puzzles", 0), colors[0][1]);

  const tasks = permutations(["X", "Y", "Z"]).filter(
    (order) =>
      order.indexOf("X") < order.indexOf("Y") &&
      order.indexOf("Y") < order.indexOf("Z"),
  );
  assert.equal(tasks.length, 1);
  assert.equal(selected("Logical Puzzles", 1), tasks[0][1]);

  const threeSeats = permutations(["Ana", "Ben", "Chirag"]).filter(
    (order) =>
      order.indexOf("Ana") < order.indexOf("Ben") &&
      order.indexOf("Ben") < order.indexOf("Chirag"),
  );
  assert.equal(threeSeats.length, 1);
  assert.equal(selected("Seating Arrangements", 0), threeSeats[0][1]);

  const fourSeats = permutations(["P", "Q", "R", "S"]).filter(
    (order) => order[0] === "P" && order[1] === "Q" && order[3] === "S",
  );
  assert.equal(fourSeats.length, 1);
  assert.equal(selected("Seating Arrangements", 1), fourSeats[0][2]);
});

test("geometric counting, ranking and sequence answers are consistent", () => {
  const checks = [
    ["Counting Figures", 0, 2 ** 2 + 1 ** 2],
    ["Counting Figures", 1, ((4 * 3) / 2) * ((3 * 2) / 2)],
    ["Cubes and Dice", 0, 2 ** 3],
    ["Cubes and Dice", 1, 7 - 2],
    ["Direction Sense", 0, Math.hypot(3, 4)],
    ["Figure Series", 0, 5 + 2],
    ["Number and Alphabet Series", 1, 3 * 5 + 1],
    ["Pattern Completion", 1, 10 - 3 - 2],
    ["Ranking and Ordering", 0, 3 + 18 - 1],
    ["Spatial Visualization", 0, 3 * 2 * 2],
    ["Spatial Visualization", 1, [1, 3, 2].length],
  ];
  for (const [title, index, expected] of checks) {
    assert.equal(numericAnswer(title, index), expected, title);
  }
  assert.equal(
    selected("Number and Alphabet Series", 0),
    String.fromCharCode(65 + 2 * 4),
  );
});
