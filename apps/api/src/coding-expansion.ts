import type { PracticeAssessment } from "@slate/contracts";
type Data = Record<string, any>;
type Family = {
  title: string;
  topic: string;
  difficulty: PracticeAssessment["difficulty"];
  prompt: (k: number) => string;
  hint: string;
  cases: (k: number) => Data[];
  solve: (data: Data, k: number) => unknown;
  limits?: string;
};
const numeric = (_k: number): Data[] => [
  { nums: Array.from({ length: 18 }, (_, i) => i + 1) },
  { nums: Array.from({ length: 18 }, (_, i) => 18 - i) },
  { nums: [-8, 2, 0, 5, 2, -3, 7, 9, 1, 4, 0, 6, 3, 8, 12, 11, 10, 15] },
  { nums: Array.from({ length: 20 }, (_, i) => i % 6) },
  { nums: Array.from({ length: 20 }, (_, i) => (i * 7) % 23) },
  { nums: Array.from({ length: 20 }, (_, i) => i - 10) },
];
const positive = (k: number) =>
  numeric(k).map((d) => ({ nums: d.nums.map((n: number) => Math.abs(n) + 1) }));
const strings = (_k: number): Data[] =>
  [
    "placementpractice",
    "abcdefghijklmnop",
    "aaaaabbbbbcccc",
    "racecarlevelnoon",
    "algorithmtraining",
    "",
  ].map((text) => ({ text }));
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
const windows = (a: number[], k: number) =>
  Array.from({ length: Math.max(0, a.length - k + 1) }, (_, i) =>
    a.slice(i, i + k),
  );
const unique = (a: number[]) => [...new Set(a)];
const families: Family[] = [
  {
    title: "Readings above",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Return how many values in nums are strictly greater than ${k}.`,
    hint: "Scan once and increment a counter only when the threshold comparison succeeds.",
    cases: numeric,
    solve: (d, k) => d.nums.filter((n: number) => n > k).length,
  },
  {
    title: "Divisibility by",
    topic: "Math",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the values in nums divisible by ${k}, retaining their original order. Zero is divisible by every positive integer.`,
    hint: "Filter using remainder zero, including negative values and zero.",
    cases: numeric,
    solve: (d, k) => d.nums.filter((n: number) => n % k === 0),
  },
  {
    title: "First-values total",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the sum of the first ${k} values of nums, or all values if fewer are present.`,
    hint: "Stop the scan after min(k, length) values.",
    cases: numeric,
    solve: (d, k) => sum(d.nums.slice(0, k)),
  },
  {
    title: "Trailing-values total",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the sum of the last ${k} values of nums, using the whole array when shorter.`,
    hint: "Begin at max(0, length-k).",
    cases: numeric,
    solve: (d, k) => sum(d.nums.slice(-k)),
  },
  {
    title: "Circular delivery shift",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Rotate nums left by ${k} places without changing the relative circular order. Return an empty array for empty input.`,
    hint: "Reduce the shift modulo the array length before joining the suffix and prefix.",
    cases: (k) => [...numeric(k), { nums: [] }],
    solve: (d, k) =>
      d.nums.length
        ? [
            ...d.nums.slice(k % d.nums.length),
            ...d.nums.slice(0, k % d.nums.length),
          ]
        : [],
  },
  {
    title: "Sensor calibration offset",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Add ${k} to every value in nums and return the calibrated array.`,
    hint: "Build an output array of identical length.",
    cases: numeric,
    solve: (d, k) => d.nums.map((n: number) => n + k),
  },
  {
    title: "Every-nth reading",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the sum of values at zero-based indices 0, ${k}, ${2 * k}, and so on in nums.`,
    hint: "Advance the index by the fixed stride.",
    cases: numeric,
    solve: (d, k) => sum(d.nums.filter((_n: number, i: number) => i % k === 0)),
  },
  {
    title: "Duplicate retention limit",
    topic: "Hash Table",
    difficulty: "Easy",
    prompt: (k) =>
      `Return nums in its original order but keep no more than ${k} occurrences of each distinct value.`,
    hint: "Track the number retained for each value in a frequency map.",
    cases: numeric,
    solve: (d, k) => {
      const count = new Map<number, number>();
      return d.nums.filter((n: number) => {
        const next = (count.get(n) ?? 0) + 1;
        count.set(n, next);
        return next <= k;
      });
    },
  },
  {
    title: "Words meeting minimum length",
    topic: "Strings",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the words in data.words with at least ${k} characters, in their original order. Words use lowercase ASCII letters.`,
    hint: "Compare each word length against the minimum.",
    cases: () => [
      {
        words: [
          "a",
          "logic",
          "programming",
          "placement",
          "go",
          "communication",
        ],
      },
      { words: [] },
      { words: ["abcdefghijk", "x", "abcdefghijk"] },
    ],
    solve: (d, k) => d.words.filter((w: string) => w.length >= k),
  },
  {
    title: "Reverse character blocks",
    topic: "Strings",
    difficulty: "Easy",
    prompt: (k) =>
      `Reverse each consecutive block of ${k} characters in text. Reverse a shorter final block too. Return the joined string.`,
    hint: "Slice disjoint blocks; reverse each and join them.",
    cases: strings,
    solve: (d, k) => {
      let out = "";
      for (let i = 0; i < d.text.length; i += k)
        out += d.text
          .slice(i, i + k)
          .split("")
          .reverse()
          .join("");
      return out;
    },
  },
  {
    title: "Binary display width",
    topic: "Bit Manipulation",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the binary representation of nonnegative n, padded on the left with zeros to a minimum width of ${k}. Never truncate longer values.`,
    hint: "Convert using base two, then prepend max(0, width-length) zeros.",
    cases: () => [0, 1, 5, 17, 255, 1024].map((n) => ({ n })),
    solve: (d, k) => d.n.toString(2).padStart(k, "0"),
  },
  {
    title: "Numeral conversion base",
    topic: "Math",
    difficulty: "Easy",
    prompt: (k) =>
      `Convert nonnegative n to base ${k + 1}. Use lowercase a for digit ten if needed, and return "0" for zero.`,
    hint: "Repeatedly divide by the base and reverse the remainder digits.",
    cases: () => [0, 1, 23, 145, 1023, 99999].map((n) => ({ n })),
    solve: (d, k) => d.n.toString(k + 1),
  },
  {
    title: "Arithmetic sequence length",
    topic: "Math",
    difficulty: "Easy",
    prompt: (k) =>
      `Given start and step, return the first ${k} terms of their arithmetic progression.`,
    hint: "Term i is start plus i times step, with i starting at zero.",
    cases: () => [
      { start: 2, step: 3 },
      { start: 10, step: -2 },
      { start: 0, step: 0 },
      { start: -7, step: 5 },
    ],
    solve: (d, k) => Array.from({ length: k }, (_, i) => d.start + i * d.step),
  },
  {
    title: "Streaks above a threshold",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the lengths of maximal consecutive runs in nums whose values are at least ${k}. Omit zero-length runs.`,
    hint: "Flush the running count when a value fails the threshold and once at the end.",
    cases: numeric,
    solve: (d, k) => {
      const out: number[] = [];
      let n = 0;
      for (const x of [...d.nums, -Infinity]) {
        if (x >= k) n++;
        else if (n) {
          out.push(n);
          n = 0;
        }
      }
      return out;
    },
  },
  {
    title: "Distinct ranking position",
    topic: "Sorting",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the ${k}th smallest DISTINCT value in nums, using one-based rank. Return null if fewer than ${k} distinct values exist.`,
    hint: "Deduplicate, sort ascending and check the requested rank.",
    cases: numeric,
    solve: (d, k) => unique(d.nums).sort((a, b) => a - b)[k - 1] ?? null,
  },
  {
    title: "Largest-value shortlist",
    topic: "Sorting",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the largest ${k} values of nums in descending order, including duplicates. Use all values when nums is shorter.`,
    hint: "Sort descending and take a prefix.",
    cases: numeric,
    solve: (d, k) => [...d.nums].sort((a, b) => b - a).slice(0, k),
  },
  {
    title: "Periodic record removal",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Remove every ${k + 1}th element from nums using one-based positions in the ORIGINAL array. Return all remaining values in order.`,
    hint: "Filter positions whose one-based index is a multiple of the interval.",
    cases: numeric,
    solve: (d, k) =>
      d.nums.filter((_n: number, i: number) => (i + 1) % (k + 1) !== 0),
  },
  {
    title: "Index bucket totals",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Return ${k} sums. Output bucket j contains the sum of nums[i] for all zero-based indices with i modulo ${k} equal to j.`,
    hint: "Create k zero buckets and accumulate using i modulo k.",
    cases: numeric,
    solve: (d, k) => {
      const out = Array(k).fill(0);
      d.nums.forEach((n: number, i: number) => (out[i % k] += n));
      return out;
    },
  },
  {
    title: "Pairs with fixed separation",
    topic: "Hash Table",
    difficulty: "Easy",
    prompt: (k) =>
      `Count index pairs i < j for which the absolute difference between nums[i] and nums[j] is exactly ${k}. Duplicates count by index.`,
    hint: "As each value arrives, count earlier values x-k and x+k using a map.",
    cases: numeric,
    solve: (d, k) => {
      let count = 0;
      for (let i = 0; i < d.nums.length; i++)
        for (let j = i + 1; j < d.nums.length; j++)
          if (Math.abs(d.nums[i] - d.nums[j]) === k) count++;
      return count;
    },
  },
  {
    title: "Fixed-length palindrome count",
    topic: "Strings",
    difficulty: "Easy",
    prompt: (k) =>
      `Count contiguous substrings of text with exactly ${k} characters that are palindromes. Overlapping occurrences count separately.`,
    hint: "Inspect each fixed-size window and compare mirrored characters.",
    cases: strings,
    solve: (d, k) =>
      windows(d.text.split(""), k).filter(
        (w) => w.join("") === w.slice().reverse().join(""),
      ).length,
  },
  {
    title: "Batch maximum readings",
    topic: "Arrays",
    difficulty: "Easy",
    prompt: (k) =>
      `Split nums into consecutive disjoint batches of size ${k} and return the maximum of each batch. Include a shorter final batch.`,
    hint: "Visit each batch once and track its maximum.",
    cases: numeric,
    solve: (d, k) => {
      const out = [];
      for (let i = 0; i < d.nums.length; i += k)
        out.push(Math.max(...d.nums.slice(i, i + k)));
      return out;
    },
  },
  {
    title: "First missing positive values",
    topic: "Hash Table",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the first ${k} positive integers absent from nums, in increasing order. Zero and negative values do not count as positive.`,
    hint: "Store values in a set and scan candidate positives until k missing values are found.",
    cases: numeric,
    solve: (d, k) => {
      const found = new Set(d.nums),
        out = [];
      for (let n = 1; out.length < k; n++) if (!found.has(n)) out.push(n);
      return out;
    },
  },
  {
    title: "Alphabet shift cipher",
    topic: "Strings",
    difficulty: "Easy",
    prompt: (k) =>
      `Shift each lowercase ASCII letter in text forward by ${k} places, wrapping z to a. Input contains only lowercase ASCII letters.`,
    hint: "Use a zero-based alphabet index and modular arithmetic.",
    cases: strings,
    solve: (d, k) =>
      [...d.text]
        .map((x: string) =>
          String.fromCharCode(97 + ((x.charCodeAt(0) - 97 + k) % 26)),
        )
        .join(""),
  },
  {
    title: "Vowel-rich windows",
    topic: "Strings",
    difficulty: "Easy",
    prompt: (k) =>
      `Return the largest number of lowercase vowels (a,e,i,o,u) in any substring of text of length ${k}. Return 0 if text is shorter.`,
    hint: "Maintain the vowel count as a window advances one character at a time.",
    cases: strings,
    solve: (d, k) =>
      Math.max(
        0,
        ...windows(d.text.split(""), k).map(
          (w) => w.filter((x) => "aeiou".includes(String(x))).length,
        ),
      ),
  },
  {
    title: "Rolling maximum window",
    topic: "Sliding Window",
    difficulty: "Medium",
    prompt: (k) =>
      `Return the maximum value in each consecutive window of ${k} elements of nums, from left to right. Return [] if no complete window exists.`,
    hint: "Maintain candidate maximum indices in a decreasing deque; expire indices outside the window.",
    cases: numeric,
    solve: (d, k) => windows(d.nums, k).map((w) => Math.max(...w)),
  },
  {
    title: "Longest text with limited variety",
    topic: "Sliding Window",
    difficulty: "Medium",
    prompt: (k) =>
      `Return the length of the longest substring of text containing at most ${k} distinct characters.`,
    hint: "Use a frequency map and shrink the left boundary while the number of distinct characters exceeds the limit.",
    cases: strings,
    solve: (d, k) => {
      let best = 0;
      for (let i = 0; i < d.text.length; i++) {
        const set = new Set();
        for (let j = i; j < d.text.length; j++) {
          set.add(d.text[j]);
          if (set.size <= k) best = Math.max(best, j - i + 1);
        }
      }
      return best;
    },
  },
  {
    title: "Subarray target total",
    topic: "Prefix Sum",
    difficulty: "Medium",
    prompt: (k) =>
      `Count all nonempty contiguous subarrays of nums whose sum equals ${k}. Values may be negative, so a monotone sliding window is insufficient.`,
    hint: "Count earlier prefix sums equal to current-prefix minus target.",
    cases: numeric,
    solve: (d, k) => {
      let n = 0;
      for (let i = 0; i < d.nums.length; i++) {
        let s = 0;
        for (let j = i; j < d.nums.length; j++) {
          s += d.nums[j];
          if (s === k) n++;
        }
      }
      return n;
    },
  },
  {
    title: "Streaming top-rank history",
    topic: "Heap",
    difficulty: "Medium",
    prompt: (k) =>
      `After each incoming value of nums, return the ${k}th largest seen so far (duplicates included). Use null before ${k} values have arrived.`,
    hint: "Retain only the k largest observed values in a min-heap.",
    cases: numeric,
    solve: (d, k) =>
      d.nums.map((_n: number, i: number) =>
        i + 1 < k
          ? null
          : d.nums.slice(0, i + 1).sort((a: number, b: number) => b - a)[k - 1],
      ),
  },
  {
    title: "Repeating-pattern anagrams",
    topic: "Sliding Window",
    difficulty: "Medium",
    prompt: (k) =>
      `Find zero-based starts of substrings that are anagrams of the first ${k} letters of the repeating sequence abcabcabc... . Return starts in increasing order.`,
    hint: "Build target letter frequencies and maintain a fixed-size window frequency difference.",
    cases: () =>
      ["abcabcbaacbabcabc", "bbbbbbbbbbbb", "abcdefghijklmnop", ""].map(
        (text) => ({ text }),
      ),
    solve: (d, k) => {
      const target = Array.from({ length: k }, (_, i) => "abc"[i % 3])
        .sort()
        .join("");
      return windows(d.text.split(""), k).flatMap((w, i) =>
        w.slice().sort().join("") === target ? [i] : [],
      );
    },
  },
  {
    title: "Road-network weight cutoff",
    topic: "Graph",
    difficulty: "Medium",
    prompt: (k) =>
      `Given n vertices 0..n-1 and undirected edges [u,v,weight], return the number of connected components using only edges with weight at most ${k}. Isolated vertices count.`,
    hint: "Union endpoints of eligible edges, decreasing the initial component count for each successful union.",
    cases: () => [
      {
        n: 6,
        edges: [
          [0, 1, 2],
          [1, 2, 5],
          [3, 4, 7],
          [4, 5, 1],
        ],
      },
      { n: 3, edges: [] },
      {
        n: 5,
        edges: [
          [0, 1, 1],
          [1, 2, 3],
          [2, 3, 6],
          [3, 4, 9],
          [0, 4, 10],
        ],
      },
    ],
    solve: (d, k) => {
      const parent = Array.from({ length: d.n }, (_, i) => i);
      const find = (x: number): number =>
        parent[x] === x ? x : (parent[x] = find(parent[x]));
      let n = d.n;
      for (const [a, b, w] of d.edges)
        if (w <= k && find(a) !== find(b)) {
          parent[find(a)] = find(b);
          n--;
        }
      return n;
    },
  },
  {
    title: "Coin-value ceiling",
    topic: "Dynamic Programming",
    difficulty: "Medium",
    prompt: (k) =>
      `Given positive integer coin denominations and amount, return the minimum coins needed using ONLY denominations at most ${k}. Each denomination is reusable. Return -1 if impossible, and 0 for amount zero.`,
    hint: "Filter eligible coins, then compute minimum counts for amounts in increasing order.",
    cases: () => [
      { coins: [1, 2, 5, 7, 10], amount: 23 },
      { coins: [2, 4, 6], amount: 17 },
      { coins: [3, 5, 9], amount: 18 },
      { coins: [2, 3], amount: 0 },
    ],
    solve: (d, k) => {
      const dp = Array(d.amount + 1).fill(Infinity);
      dp[0] = 0;
      for (let n = 1; n <= d.amount; n++)
        for (const c of d.coins)
          if (c <= k && c <= n) dp[n] = Math.min(dp[n], dp[n - c] + 1);
      return Number.isFinite(dp[d.amount]) ? dp[d.amount] : -1;
    },
  },
  {
    title: "Merge nearby intervals",
    topic: "Intervals",
    difficulty: "Medium",
    prompt: (k) =>
      `Merge sorted or unsorted CLOSED intervals when the next interval starts no more than ${k} after the current group's end. Return merged [start,end] pairs ordered by start.`,
    hint: "Sort starts, then extend the last merged interval whenever the allowed gap condition holds.",
    cases: () => [
      {
        intervals: [
          [1, 3],
          [5, 7],
          [12, 14],
          [18, 20],
        ],
      },
      {
        intervals: [
          [5, 9],
          [1, 2],
          [8, 10],
        ],
      },
      { intervals: [] },
      {
        intervals: [
          [0, 0],
          [10, 10],
          [20, 20],
        ],
      },
    ],
    solve: (d, k) => {
      const out: number[][] = [];
      for (const [a, b] of d.intervals
        .slice()
        .sort((a: number[], b: number[]) => a[0] - b[0])) {
        const last = out.at(-1);
        if (last && a <= last[1] + k) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
      }
      return out;
    },
  },
  {
    title: "Training kit capacity",
    topic: "Dynamic Programming",
    difficulty: "Medium",
    prompt: (k) =>
      `Choose a subset of items [weight,value] to maximize total value with total weight at most ${10 * k}. Each item may be used once; return the maximum value.`,
    hint: "Use a capacity DP and iterate capacities downward for each item to prevent reuse.",
    cases: () => [
      {
        items: [
          [10, 20],
          [20, 30],
          [30, 66],
          [5, 8],
        ],
      },
      {
        items: [
          [1, 2],
          [4, 7],
          [12, 40],
          [28, 100],
        ],
      },
      { items: [] },
      {
        items: [
          [11, 9],
          [7, 13],
          [16, 35],
        ],
      },
    ],
    solve: (d, k) => {
      const cap = k * 10,
        dp = Array(cap + 1).fill(0);
      for (const [w, v] of d.items)
        for (let c = cap; c >= w; c--) dp[c] = Math.max(dp[c], dp[c - w] + v);
      return dp[cap];
    },
  },
  {
    title: "Bounded-rise subsequence",
    topic: "Dynamic Programming",
    difficulty: "Medium",
    prompt: (k) =>
      `Return the longest strictly increasing subsequence of nums in which each adjacent selected value increases by no more than ${k}. The subsequence need not be contiguous.`,
    hint: "For each value, query the best prior length in [value-k,value-1]; coordinate compression and a range-max tree support large inputs.",
    cases: numeric,
    solve: (d, k) => {
      const dp = d.nums.map(() => 1);
      for (let j = 0; j < d.nums.length; j++)
        for (let i = 0; i < j; i++)
          if (d.nums[j] > d.nums[i] && d.nums[j] - d.nums[i] <= k)
            dp[j] = Math.max(dp[j], dp[i] + 1);
      return Math.max(0, ...dp);
    },
  },
  {
    title: "Lower-median threshold subarrays",
    topic: "Order Statistics",
    difficulty: "Hard",
    prompt: (k) =>
      `Count nonempty subarrays of nums whose LOWER median is at least ${k}. For a sorted subarray of length m, its lower median is element floor((m-1)/2), zero-based.`,
    hint: "Map values meeting the threshold to +1 and the rest to -1. Count strictly increasing prefix-sum pairs with a Fenwick tree.",
    cases: numeric,
    solve: (d, k) => {
      let count = 0;
      for (let i = 0; i < d.nums.length; i++)
        for (let j = i; j < d.nums.length; j++) {
          const a = d.nums
            .slice(i, j + 1)
            .sort((a: number, b: number) => a - b);
          if (a[Math.floor((a.length - 1) / 2)] >= k) count++;
        }
      return count;
    },
    limits:
      "0 ≤ n ≤ 100,000; use a 64-bit integer for the number of subarrays.",
  },
  {
    title: "Pair-distance order statistic",
    topic: "Binary Search",
    difficulty: "Hard",
    prompt: (k) =>
      `Return the ${k}th smallest absolute difference among all index pairs i<j in nums, counting equal distances separately. There are at least ${k} pairs.`,
    hint: "Sort values and binary-search the distance. A two-pointer pass counts pairs at most a candidate distance.",
    cases: numeric,
    solve: (d, k) => {
      const a = [];
      for (let i = 0; i < d.nums.length; i++)
        for (let j = i + 1; j < d.nums.length; j++)
          a.push(Math.abs(d.nums[i] - d.nums[j]));
      return a.sort((a, b) => a - b)[k - 1];
    },
  },
  {
    title: "Minimize largest partition total",
    topic: "Binary Search",
    difficulty: "Hard",
    prompt: (k) =>
      `Split the nonnegative nums array into exactly ${k} nonempty contiguous partitions. Return the smallest possible largest partition sum. Input length is at least ${k}.`,
    hint: "Binary-search between the largest element and total sum. Greedily count groups needed for each candidate maximum.",
    cases: positive,
    solve: (d, k) => {
      const n = d.nums.length,
        dp = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity));
      dp[0][0] = 0;
      const prefix = [0];
      for (const x of d.nums) prefix.push(prefix.at(-1)! + x);
      for (let g = 1; g <= k; g++)
        for (let end = g; end <= n; end++)
          for (let cut = g - 1; cut < end; cut++)
            dp[g][end] = Math.min(
              dp[g][end],
              Math.max(dp[g - 1][cut], prefix[end] - prefix[cut]),
            );
      return dp[k][n];
    },
  },
  {
    title: "Increasing grid climb limit",
    topic: "Graph",
    difficulty: "Hard",
    prompt: (k) =>
      `Return the longest path length in grid using orthogonal moves to a STRICTLY larger value, where each increase is at most ${k}. Reusing cells is prohibited. Return 0 for an empty grid.`,
    hint: "Strict increases form a DAG. Memoize the best path starting at each cell, or process cells in topological value order.",
    cases: () => [
      {
        grid: [
          [1, 4, 7],
          [2, 3, 8],
          [9, 6, 5],
        ],
      },
      {
        grid: [
          [5, 5],
          [5, 5],
        ],
      },
      {
        grid: [
          [10, 8, 6],
          [1, 2, 3],
        ],
      },
      { grid: [] },
    ],
    solve: (d, k) => {
      const a = d.grid as number[][];
      if (!a.length) return 0;
      const m = a.length,
        n = a[0].length,
        memo = new Map<string, number>();
      const visit = (r: number, c: number): number => {
        const key = r + "," + c;
        if (memo.has(key)) return memo.get(key)!;
        let best = 1;
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = r + dr,
            y = c + dc;
          if (
            x >= 0 &&
            y >= 0 &&
            x < m &&
            y < n &&
            a[x][y] > a[r][c] &&
            a[x][y] - a[r][c] <= k
          )
            best = Math.max(best, 1 + visit(x, y));
        }
        memo.set(key, best);
        return best;
      };
      return Math.max(
        ...a.flatMap((row, r) => row.map((_v, c) => visit(r, c))),
      );
    },
    limits:
      "Up to 100,000 grid cells. Plan for a long increasing path without overflowing a call stack.",
  },
  {
    title: "Exact-variety subarray count",
    topic: "Sliding Window",
    difficulty: "Hard",
    prompt: (k) =>
      `Count nonempty contiguous subarrays of nums containing exactly ${k} distinct values. Repeated values do not increase the distinct count.`,
    hint: "Subtract the count with at most k-1 distinct values from the count with at most k distinct; each count uses a sliding window.",
    cases: numeric,
    solve: (d, k) => {
      let count = 0;
      for (let i = 0; i < d.nums.length; i++) {
        const set = new Set();
        for (let j = i; j < d.nums.length; j++) {
          set.add(d.nums[j]);
          if (set.size === k) count++;
        }
      }
      return count;
    },
    limits: "0 ≤ n ≤ 100,000. The count may exceed a signed 32-bit integer.",
  },
  {
    title: "Delivery round-trip stops",
    topic: "Bitmask DP",
    difficulty: "Hard",
    prompt: (k) =>
      `Given a (${k + 1})×(${k + 1}) cost matrix, begin at vertex 0, visit each of the other ${k} vertices exactly once, and return to 0. Return minimum tour cost. Costs are nonnegative and directed; diagonal values are zero.`,
    hint: "Let DP[visitedMask][last] hold the cheapest path from 0 through the selected delivery stops; append the return edge at the end.",
    cases: (k) =>
      [1, 3, 7].map((seed) => ({
        cost: Array.from({ length: k + 1 }, (_, i) =>
          Array.from({ length: k + 1 }, (_, j) =>
            i === j ? 0 : 1 + ((i * 7 + j * 11 + seed * 3) % 29),
          ),
        ),
      })),
    solve: (d, k) => {
      const memo = new Map<string, number>(),
        end = (1 << k) - 1;
      const visit = (mask: number, last: number): number => {
        if (mask === end) return d.cost[last][0];
        const key = mask + "," + last;
        if (memo.has(key)) return memo.get(key)!;
        let best = Infinity;
        for (let city = 1; city <= k; city++)
          if (!(mask & (1 << (city - 1))))
            best = Math.min(
              best,
              d.cost[last][city] + visit(mask | (1 << (city - 1)), city),
            );
        memo.set(key, best);
        return best;
      };
      return visit(0, 0);
    },
    limits:
      "1 to 10 delivery stops, plus start vertex 0. Matrix entries are integers 0..1,000,000.",
  },
];
export function expandedCodingCatalog(
  starter: (title: string) => Record<string, string>,
): PracticeAssessment[] {
  return families.flatMap((family, index) =>
    Array.from({ length: 10 }, (_, variant) => {
      const k = variant + 1,
        title = `${family.title} · ${k}`,
        statement = family.prompt(k);
      const testCases = family
        .cases(k)
        .map((data, i) => ({
          input: JSON.stringify(data),
          output: JSON.stringify(family.solve(data, k)),
          description: i === 0 ? "Worked example" : `Validation case ${i + 1}`,
        }));
      return {
        id: `cp-${201 + index * 10 + variant}`,
        number: 201 + index * 10 + variant,
        title,
        description: statement,
        category: "coding",
        kind: "coding",
        difficulty: family.difficulty,
        durationMinutes:
          family.difficulty === "Easy"
            ? 20
            : family.difficulty === "Medium"
              ? 30
              : 45,
        sample: true,
        topics: [family.topic],
        problem: {
          statement: `${statement} Implement solve(data) and return the JSON-compatible result. This is a parameter-focused exercise; the fixed value is part of the task.`,
          examples: testCases
            .slice(0, 2)
            .map((row) => ({ ...row, explanation: row.description })),
          testCases,
          constraints: [
            family.limits ??
              (family.difficulty === "Easy"
                ? "Input contains up to 10,000 elements or characters. All numbers are signed 32-bit integers unless otherwise stated."
                : "Input contains up to 100,000 elements or characters. Choose an algorithm suited to the stated limits."),
            "Fixed parameter values are given in the statement; do not infer them from the sample input.",
          ],
          starterCode: starter(title),
          hints: [family.hint],
          approach: family.hint,
        },
      };
    }),
  );
}
