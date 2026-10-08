import type { PracticeAssessment } from "@slate/contracts";

// Original sample prompts. Each row is a complete challenge with JSON input,
// a reference output and an approach hint; no third-party problem text is copied.
const groups = [
  {
    topic: "Arrays",
    constraints:
      "1 ≤ array length ≤ 100,000; integer values fit a signed 32-bit integer.",
    rows: `Two Sum|Easy|Return two distinct zero-based indices whose values add to target. Exactly one pair exists.|{"nums":[2,7,11,15],"target":9}|[0,1]|Remember the index of each value while looking for its complement.
Contains Duplicate|Easy|Return whether any integer appears more than once in nums.|{"nums":[1,2,3,1]}|true|Compare the array length with the size of a set.
Squares of a Sorted Array|Easy|Return the squares in nondecreasing order. The input is already sorted.|{"nums":[-4,-1,0,3,10]}|[0,1,9,16,100]|Compare absolute values at both ends and fill the result backwards.
Maximum Subarray|Medium|Return the largest sum of a nonempty contiguous subarray.|{"nums":[-2,1,-3,4,-1,2,1,-5,4]}|6|Track the best sum ending at each position.
Rotate an Array|Medium|Rotate nums to the right by k positions and return the resulting array.|{"nums":[1,2,3,4,5],"k":2}|[4,5,1,2,3]|Reduce k modulo the length; reverse the whole array and its two parts.
Product Without Self|Medium|Return an array whose entry i is the product of all other entries. Do not divide; products fit 64-bit integers.|{"nums":[1,2,3,4]}|[24,12,8,6]|Multiply prefix and suffix products.
First Missing Positive|Hard|Return the smallest positive integer absent from an unsorted array using linear time and constant extra space.|{"nums":[3,4,-1,1]}|2|Place each usable value x at index x minus one.
Water Between Bars|Hard|Nonnegative heights describe unit-width bars. Return the total rainwater trapped between them.|{"height":[0,1,0,2,1,0,1,3,2,1,2,1]}|6|A bar holds water up to the smaller maximum on its left and right.
Merge Overlapping Ranges|Medium|Merge inclusive intervals that overlap and return them sorted by start.|{"intervals":[[1,3],[2,6],[8,10],[15,18]]}|[[1,6],[8,10],[15,18]]|Sort starts and extend the last merged interval when they overlap.
Next Lexicographic Arrangement|Medium|Return the next lexicographic permutation of nums, or the ascending arrangement if none exists.|{"nums":[1,2,3]}|[1,3,2]|Find the rightmost ascent, swap its pivot, then reverse the suffix.`,
  },
  {
    topic: "Strings",
    constraints:
      "0 ≤ text length ≤ 100,000; use ASCII characters unless the prompt says lowercase letters.",
    rows: `Reverse the Words|Easy|Trim extra spaces and return the words in reverse order, separated by single spaces.|{"text":"  learn code daily "}|"daily code learn"|Split on whitespace, reverse the words and join them.
Valid Palindrome Text|Easy|Ignore nonalphanumeric characters and case; return whether the remaining text is a palindrome.|{"text":"A man, a plan, a canal: Panama"}|true|Move two pointers inward, skipping punctuation.
Longest Shared Prefix|Easy|Return the longest prefix shared by all strings, or an empty string.|{"words":["flower","flow","flight"]}|"fl"|Shrink a candidate prefix until every word begins with it.
Compress Character Runs|Medium|Return each consecutive character followed by its run length, omitting the number for singleton runs.|{"text":"aaabbc"}|"a3b2c"|Flush a run whenever the character changes.
Decode Repeated Text|Medium|Decode nested count[segment] expressions. Counts are positive and brackets are balanced; decoded output has at most 100,000 characters.|{"text":"3[a2[c]]"}|"accaccacc"|Use a stack of repeat counts and accumulated prefixes.
Longest Palindromic Span|Medium|Return the longest palindromic substring; choose the earliest start on ties.|{"text":"babad"}|"bab"|Expand around both character and gap centers.
Group Matching Letters|Medium|Group lowercase words that have the same letter counts. Preserve group order by first appearance and word order within each group.|{"words":["eat","tea","tan","ate","nat","bat"]}|[["eat","tea","ate"],["tan","nat"],["bat"]]|Use a letter-count signature as a map key.
Minimum Covering Text|Hard|Return the shortest substring of s containing every character of t with multiplicity; choose earliest on ties, or empty if impossible.|{"s":"ADOBECODEBANC","t":"ABC"}|"BANC"|Expand until covered, then shrink while keeping every required count.
Wildcard Text Match|Hard|Return whether pattern matches the entire text; ? matches one character and * matches any sequence.|{"text":"adceb","pattern":"*a*b"}|true|Track matching prefixes with dynamic programming.
Version Number Comparison|Medium|Compare dot-separated nonnegative numeric version components, ignoring leading zeros and missing trailing zeros; return -1, 0 or 1.|{"a":"1.01","b":"1.001.0"}|0|Compare integer components one by one, padding with zero.`,
  },
  {
    topic: "Hash Table",
    constraints:
      "0 ≤ collection length ≤ 100,000; keys are integers or lowercase words.",
    rows: `First Unique Character|Easy|Return the index of the first character occurring exactly once, or -1.|{"text":"swiss"}|1|Count characters, then scan the original order.
Common Distinct Values|Easy|Return the distinct values present in both arrays, sorted ascending.|{"a":[1,2,2,3],"b":[2,2,4]}|[2]|Intersect two sets.
Word Frequency Report|Easy|Count each lowercase word and return [word,count] pairs sorted alphabetically.|{"words":["code","learn","code"]}|[["code",2],["learn",1]]|Aggregate in a map and sort its keys.
Longest Consecutive Run|Medium|Return the length of the longest consecutive integer sequence, regardless of input order, in expected linear time.|{"nums":[100,4,200,1,3,2]}|4|Only extend sequences from values with no predecessor in the set.
Top Frequent Integers|Medium|Return the k most frequent values ordered by decreasing frequency then increasing value.|{"nums":[1,1,1,2,2,3],"k":2}|[1,2]|Count values and rank the resulting entries.
Isomorphic Words|Medium|Return whether a one-to-one character mapping transforms s into t.|{"s":"egg","t":"add"}|true|Maintain forward and reverse maps.
Four-Array Zero Sums|Medium|Count index quadruples selecting one value from each array whose sum is zero.|{"a":[1,2],"b":[-2,-1],"c":[-1,2],"d":[0,2]}|2|Store frequencies of pair sums from the first two arrays.
Substring Word Concatenation|Hard|Return sorted starts where a substring concatenates all equal-length words exactly once, in any order.|{"text":"barfoothefoobarman","words":["foo","bar"]}|[0,9]|Use word-sized windows for each possible starting offset.
Pair Distance Counts|Medium|Count distinct unordered value pairs with absolute difference k; k is nonnegative, and k=0 requires two occurrences.|{"nums":[3,1,4,1,5],"k":2}|2|For positive k look for x+k; for zero inspect frequencies.
Smallest Window of Distinct Values|Hard|Return the length of the shortest contiguous window containing every distinct input value at least once; empty input returns 0.|{"nums":[1,2,2,3,1,2,3]}|3|Count distinct values globally, then maintain coverage in a sliding window.`,
  },
  {
    topic: "Two Pointers",
    constraints:
      "1 ≤ sequence length ≤ 100,000; sorted inputs are nondecreasing; integer arithmetic fits 64 bits.",
    rows: `Move Zeros to the End|Easy|Return nums with zeros moved to the end and other values in their original order.|{"nums":[0,1,0,3,12]}|[1,3,12,0,0]|Write nonzero values at the next available position.
Remove Sorted Duplicates|Easy|Return one occurrence of each value from a sorted array.|{"nums":[1,1,2,2,3]}|[1,2,3]|Compare each value with the last retained one.
Merge Two Sorted Arrays|Easy|Return a sorted array containing every value from both sorted inputs.|{"a":[1,3,5],"b":[2,4]}|[1,2,3,4,5]|Advance the pointer holding the smaller next value.
Three Values Sum to Zero|Medium|Return unique ascending triplets summing to zero; sort the list of triplets lexicographically.|{"nums":[-1,0,1,2,-1,-4]}|[[-1,-1,2],[-1,0,1]]|Sort, fix one value, and move two pointers while skipping duplicates.
Largest Water Container|Medium|Choose two height bars; return the greatest area between them without intermediate bars affecting the water.|{"height":[1,8,6,2,5,4,8,3,7]}|49|Move the smaller boundary inward because it limits the current area.
Partition Three Colors|Medium|Sort an array containing only 0, 1 and 2 using one pass and constant extra space.|{"nums":[2,0,2,1,1,0]}|[0,0,1,1,2,2]|Maintain boundaries for zero, unknown and two regions.
Closest Three-Value Sum|Medium|Return the three-value sum closest to target; choose the smaller sum on ties. At least three values exist.|{"nums":[-1,2,1,-4],"target":1}|2|Sort and adjust a pair of pointers around each fixed value.
Four-Value Target Tuples|Medium|Return distinct ascending quadruplets summing to target, ordered lexicographically.|{"nums":[1,0,-1,0,-2,2],"target":0}|[[-2,-1,1,2],[-2,0,0,2],[-1,0,0,1]]|Fix two positions and solve the remaining pair with two pointers.
Closest Cross-Array Pair|Hard|From two sorted nonempty arrays, return the lexicographically smallest [aValue,bValue] pair minimizing distance from their sum to target.|{"a":[1,4,7],"b":[2,5,8],"target":10}|[1,8]|Begin at the smallest a and largest b; compare distance and tie ordering.
Minimum Deletions for a Palindrome|Hard|Return the fewest characters to delete to make text a palindrome; length is at most 500.|{"text":"abcda"}|2|Matching ends cost nothing; unequal ends require dropping one side and memoizing.`,
  },
  {
    topic: "Sliding Window",
    constraints:
      "1 ≤ sequence length ≤ 100,000; window k is valid; sums fit 64 bits.",
    rows: `Maximum Fixed Window Sum|Easy|Return the greatest sum among contiguous windows of exactly k integers.|{"nums":[2,1,5,1,3,2],"k":3}|9|Add the entering value and remove the leaving value.
Fixed Window Vowel Count|Easy|Return the greatest number of vowels in any length-k substring of lowercase text.|{"text":"abciiidef","k":3}|3|Update a vowel count as the window moves.
Nearby Duplicate Values|Easy|Return whether equal values occur at distinct indices at most k positions apart.|{"nums":[1,2,3,1],"k":3}|true|Keep values from the last k positions in a set.
Longest Unique Substring|Medium|Return the maximum length of a substring containing no repeated characters.|{"text":"abcabcbb"}|3|Move the left boundary past a repeated character's previous position.
Minimum Positive Sum Window|Medium|Given positive integers, return the shortest window with sum at least target; return 0 if none.|{"nums":[2,3,1,2,4,3],"target":7}|2|Shrink every window whose sum already reaches the target.
Longest Window With K Distinct|Medium|Return the longest substring length containing at most k distinct characters.|{"text":"eceba","k":2}|3|Shrink whenever the frequency map has too many keys.
Permutation Inside Text|Medium|Return whether text contains a substring that is a permutation of lowercase pattern.|{"pattern":"ab","text":"eidbaooo"}|true|Compare counts in each pattern-sized window.
Longest Ones After K Changes|Medium|Return the longest window of a binary array that contains at most k zeros.|{"nums":[1,1,1,0,0,0,1,1,1,1,0],"k":2}|6|Maintain the zero count and shrink when it exceeds k.
Sliding Window Maximums|Hard|Return the maximum in every contiguous window of length k in linear time.|{"nums":[1,3,-1,-3,5,3,6,7],"k":3}|[3,3,5,5,6,7]|Keep indices in a decreasing deque and evict expired indices.
Exactly K Distinct Subarrays|Hard|Count nonempty contiguous subarrays with exactly k distinct integer values.|{"nums":[1,2,1,2,3],"k":2}|7|Subtract the number with at most k-1 distinct values from at most k.`,
  },
  {
    topic: "Prefix Sum",
    constraints:
      "1 ≤ array length ≤ 100,000; query endpoints are inclusive and valid; totals fit 64 bits.",
    rows: `Range Sum Queries|Easy|For every inclusive [left,right] query, return the sum of the corresponding array range.|{"nums":[2,4,1,5],"queries":[[0,2],[1,3]]}|[7,10]|Subtract prefix sums at the two boundaries.
Find the Balance Index|Easy|Return the first index whose left-side sum equals its right-side sum, excluding the value at that index; return -1 if absent.|{"nums":[1,7,3,6,5,6]}|3|Compare a running sum with total minus current value minus running sum.
Running Totals|Easy|Return an array of cumulative sums.|{"nums":[1,2,3,4]}|[1,3,6,10]|Accumulate each value into a running total.
Subarray Sum Equals Target|Medium|Count contiguous nonempty subarrays summing to target; values may be negative.|{"nums":[1,1,1],"target":2}|2|Count earlier prefix sums equal to current prefix minus target.
Balanced Binary Span|Medium|Return the greatest length of a binary subarray with equally many zeros and ones.|{"nums":[0,1,0]}|2|Treat zero as -1 and remember the first index of each prefix balance.
Subarrays Divisible by K|Medium|Count nonempty subarrays whose sum is divisible by positive k.|{"nums":[4,5,0,-2,-3,1],"k":5}|7|Equal normalized prefix remainders define divisible subarrays.
Rectangle Sum Queries|Medium|For each inclusive rectangle [r1,c1,r2,c2], return its cell sum.|{"matrix":[[1,2],[3,4]],"queries":[[0,0,1,1],[0,1,1,1]]}|[10,6]|Build a two-dimensional prefix table and use inclusion-exclusion.
Range Increment Updates|Medium|Start with n zeros. Apply every inclusive [left,right,delta] update and return the final array.|{"n":5,"updates":[[1,3,2],[2,4,3]]}|[0,2,5,5,3]|Record changes at each range boundary, then take a prefix sum.
Shortest Sum Threshold Span|Hard|Values may be negative. Return the shortest nonempty subarray with sum at least target, or -1.|{"nums":[2,-1,2],"target":3}|3|Keep increasing prefix sums in a deque and discard dominated candidates.
Maximum Sum Rectangle|Hard|Return the greatest sum of a nonempty rectangle in an integer matrix; each dimension is at most 150.|{"matrix":[[1,-2],[3,4]]}|7|Fix two row boundaries and apply a maximum-subarray scan to column sums.`,
  },
  {
    topic: "Binary Search",
    constraints:
      "0 ≤ sorted array length ≤ 100,000; values fit 32-bit integers; search ranges are finite.",
    rows: `Sorted Value Lookup|Easy|Return the zero-based index of target in a sorted distinct array, or -1.|{"nums":[-1,0,3,5,9,12],"target":9}|4|Keep the half that can still contain the target.
Insertion Position|Easy|Return the first index at which target can be inserted without breaking nondecreasing order.|{"nums":[1,3,5,6],"target":2}|1|Find the first value greater than or equal to target.
Integer Square Root|Easy|For nonnegative n up to 2^31-1, return the floor of its square root without using sqrt.|{"n":8}|2|Compare mid with n divided by mid to avoid overflow.
First and Last Position|Medium|Return the first and last indices of target in a sorted array, or [-1,-1].|{"nums":[5,7,7,8,8,10],"target":8}|[3,4]|Run separate lower-bound and upper-bound searches.
Rotated Sorted Lookup|Medium|A distinct sorted array was rotated. Return target's index, or -1.|{"nums":[4,5,6,7,0,1,2],"target":0}|4|At least one half remains sorted at every step.
Smallest Value After Rotation|Medium|Return the smallest value in a rotated sorted array with distinct values.|{"nums":[3,4,5,1,2]}|1|Compare the midpoint with the right boundary.
Minimum Shipping Capacity|Medium|Ship package weights in order within days using equal daily capacity. Return the smallest required capacity.|{"weights":[1,2,3,4,5,6,7,8,9,10],"days":5}|15|Binary-search capacity and greedily count days for each candidate.
Minimum Eating Rate|Medium|A worker handles one pile per hour and processes at most speed units in it. Return minimum integer speed to finish within h hours; h ≥ pile count.|{"piles":[3,6,7,11],"h":8}|4|Check a speed by summing ceiling divisions.
Median of Two Sorted Sequences|Hard|Return the median of all values in two sorted arrays in logarithmic time; at least one is nonempty.|{"a":[1,3],"b":[2]}|2|Partition both arrays so the left half contains half the total values.
Split to Minimize Largest Sum|Hard|Split a nonnegative array into exactly k nonempty contiguous parts. Return the smallest possible maximum part sum.|{"nums":[7,2,5,10,8],"k":2}|18|Binary-search the largest allowed sum; greedily count required parts.`,
  },
  {
    topic: "Sorting",
    constraints:
      "0 ≤ collection length ≤ 100,000; retain duplicates unless told otherwise.",
    rows: `Sort Student Scores|Easy|Return integer scores in descending order.|{"scores":[72,91,68,91]}|[91,91,72,68]|Sort using a descending numeric comparator.
Merge Sorted Records|Easy|Sort records by score descending then name alphabetically and return their names.|{"records":[["Diya",80],["Aarav",90],["Rohan",80]]}|["Aarav","Diya","Rohan"]|Use both fields in the comparator.
Minimum Adjacent Difference|Easy|Return the smallest absolute difference between any two values; at least two values exist.|{"nums":[4,2,1,3]}|1|The closest pair is adjacent after sorting.
Kth Largest Value|Medium|Return the kth largest array value counting duplicates; 1 ≤ k ≤ length.|{"nums":[3,2,1,5,6,4],"k":2}|5|Partition around a pivot or maintain a k-sized min heap.
Largest Joined Number|Medium|Arrange nonnegative integers to form the largest concatenated decimal string. An all-zero input returns 0 as a string.|{"nums":[3,30,34,5,9]}|"9534330"|Compare string concatenations ab and ba.
Inversion Count|Hard|Count pairs i<j with nums[i]>nums[j] in O(n log n) time.|{"nums":[2,4,1,3,5]}|3|Count cross-half inversions during merge sort.
Relative Priority Sort|Medium|Place values present in order first, in that order and with duplicates. Sort all remaining values ascending.|{"nums":[2,3,1,3,2,4,6,7,9,2,19],"order":[2,1,4,3,9,6]}|[2,2,2,1,4,3,3,9,6,7,19]|Assign each priority value a rank before sorting.
Minimum Meeting Rooms|Medium|Intervals are half-open [start,end). Return the maximum number of simultaneous meetings.|{"intervals":[[0,30],[5,10],[15,20]]}|2|Process end events before start events at equal times.
Count Smaller Values to the Right|Hard|For each position, return the count of strictly smaller values to its right.|{"nums":[5,2,6,1]}|[2,1,1,0]|Use indexed merge sort or compressed ranks with a Fenwick tree.
Maximum Pair Chain|Medium|Each pair [a,b] has a<b. Return the longest chain where each previous b is strictly less than the next a.|{"pairs":[[1,2],[2,3],[3,4]]}|2|Sort by the second value and greedily take the earliest finishing pair.`,
  },
  {
    topic: "Stack",
    constraints:
      "0 ≤ operation or text length ≤ 100,000; parentheses use (), [] and {}; divisions truncate toward zero.",
    rows: `Balanced Brackets|Easy|Return whether brackets are balanced and correctly nested; the text contains only bracket characters.|{"text":"([]){}"}|true|Match every closing bracket with the most recent opening bracket.
Undo Typed Characters|Easy|A # erases the preceding character if present. Return whether two typed strings produce the same final text.|{"a":"ab#c","b":"ad#c"}|true|Simulate each text with a stack, or scan backwards.
Remove Adjacent Equal Pairs|Easy|Repeatedly delete neighboring identical characters and return the remaining string.|{"text":"abbaca"}|"ca"|Cancel a character against the top of the stack.
Next Warmer Day|Medium|For each temperature, return days until a strictly warmer temperature, or zero.|{"temperatures":[73,74,75,71,69,72,76,73]}|[1,1,4,2,1,1,0,0]|Resolve a stack of waiting indices when a warmer day arrives.
Reverse Polish Evaluation|Medium|Evaluate tokens using binary +, -, *, and /; every expression is valid.|{"tokens":["2","1","+","3","*"]}|9|Pop the right operand before the left operand.
Asteroid Encounters|Medium|Positive values move right and negative values left, with magnitudes as sizes. Return survivors after smaller colliding asteroids disappear; equal sizes both disappear.|{"asteroids":[5,10,-5]}|[5,10]|Only a positive stack top and a negative new value can collide.
Simplify Absolute Path|Medium|Normalize an absolute Unix path using . and .. and redundant slashes.|{"path":"/a/./b/../../c/"}|"/c"|Push regular names, ignore dots and pop for parent references.
Largest Histogram Rectangle|Hard|Return the largest rectangle under nonnegative unit-width histogram bars.|{"heights":[2,1,5,6,2,3]}|10|A monotonic stack identifies each bar's maximal span.
Longest Valid Parentheses|Hard|Return the longest contiguous substring length forming valid parentheses; text contains only ( and ).|{"text":")()())"}|4|Store indices of unmatched brackets and the last invalid boundary.
Minimum Stack Operations|Medium|Process push, pop and min commands on a stack; return all min results. Pop/min are only issued when nonempty.|{"commands":[["push",3],["push",1],["min"],["pop"],["min"]]}|[1,3]|Store the current minimum alongside each pushed value.`,
  },
  {
    topic: "Queue",
    constraints:
      "0 ≤ operation count ≤ 100,000; dequeue/front operations occur only when nonempty.",
    rows: `Queue With Two Stacks|Easy|Process enqueue, dequeue and front commands and return values from dequeue/front.|{"commands":[["enqueue",1],["enqueue",2],["front"],["dequeue"],["front"]]}|[1,1,2]|Transfer the input stack only when the output stack is empty.
Recent Request Counts|Easy|Given strictly increasing request times, return request counts within the inclusive interval [time-3000,time] at every request.|{"times":[1,100,3001,3002]}|[1,2,3,3]|Remove expired times from the front.
Round Robin Service|Easy|Process names in queue order. Each needs one turn per unit in work; append unfinished names again. Return the completion order.|{"names":["A","B","C"],"work":[2,1,2]}|["B","A","C"]|Decrement work on every turn and requeue unfinished items.
First Negative in Each Window|Medium|Return the first negative value in each length-k window, or zero when none.|{"nums":[12,-1,-7,8,-15,30,16,28],"k":3}|[-1,-1,-7,-15,-15,0]|Keep indices of negative values in a deque.
Reveal Cards in Increasing Order|Medium|Arrange distinct cards so repeatedly revealing the top card then moving the next to the bottom reveals values ascending.|{"cards":[17,13,11,2,3,5,7]}|[2,13,3,11,5,17,7]|Simulate the reveal process with a queue of output positions.
Grid Nearest Zero Distances|Medium|For each binary grid cell, return its shortest four-direction distance to a zero; at least one zero exists.|{"grid":[[0,0,0],[0,1,0],[1,1,1]]}|[[0,0,0],[0,1,0],[1,2,1]]|Start breadth-first search from all zeros at once.
Rotting Fruit Minutes|Medium|Grid values 0 empty, 1 fresh and 2 rotten. Rotten fruit spreads four-directionally each minute. Return minutes until all fresh rot, or -1.|{"grid":[[2,1,1],[1,1,0],[0,1,1]]}|4|Use a queue with levels and count unvisited fresh fruit.
Constrained Maximum Subsequence|Hard|Choose a nonempty subsequence where consecutive chosen indices differ by at most k; return its maximum sum.|{"nums":[10,2,-10,5,20],"k":2}|37|Maintain a deque of best positive dynamic-programming scores in the last k indices.
Shortest Grid Route With Removals|Hard|Move four-directionally through a 0/1 grid, removing at most k blocked cells. Return the shortest distance from top-left to bottom-right, or -1; endpoints are open.|{"grid":[[0,1,0],[0,1,0],[0,0,0]],"k":1}|4|Breadth-first states include the remaining removal budget.
Circular Queue Simulation|Medium|Process enqueue and dequeue on capacity-sized queue. Return true/false for enqueue and removed value or -1 for dequeue.|{"capacity":2,"commands":[["enqueue",5],["enqueue",6],["enqueue",7],["dequeue"],["enqueue",8]]}|[true,true,false,5,true]|Track head, size and insertion index modulo capacity.`,
  },
  {
    topic: "Linked List",
    constraints:
      "Lists use JSON arrays; 0 ≤ node count ≤ 100,000. Cycle inputs specify a zero-based join index or -1.",
    rows: `Reverse List Values|Easy|Reverse a singly linked list and return its values.|{"values":[1,2,3,4]}|[4,3,2,1]|Reverse one next pointer at a time.
Middle List Value|Easy|Return the middle value, choosing the second middle when the list length is even. The list is nonempty.|{"values":[1,2,3,4]}|3|A fast pointer moves twice as quickly as a slow pointer.
Detect a List Cycle|Easy|The last node points to the node at join, or null for -1. Return whether a cycle exists.|{"values":[3,2,0,-4],"join":1}|true|A slow and fast pointer meet only when a cycle exists.
Merge Ordered Lists|Medium|Merge two sorted singly linked lists and return the sorted values.|{"a":[1,2,4],"b":[1,3,4]}|[1,1,2,3,4]|Attach the smaller current node to a dummy head's tail.
Remove Nth Node From End|Medium|Remove the nth node counted from the tail and return remaining values; n is valid.|{"values":[1,2,3,4,5],"n":2}|[1,2,3,5]|Keep two pointers n positions apart and use a dummy head.
Add Reversed Digit Lists|Medium|Each list stores a nonnegative number with least-significant digit first. Return its sum in the same representation.|{"a":[2,4,3],"b":[5,6,4]}|[7,0,8]|Advance both lists while carrying overflow to the next digit.
Reorder Alternating Ends|Medium|Reorder list L0,L1,...,Ln into L0,Ln,L1,Ln-1,... and return values.|{"values":[1,2,3,4,5]}|[1,5,2,4,3]|Reverse the second half and interleave the two halves.
Reverse Every K Nodes|Hard|Reverse nodes in groups of k, leaving a final group shorter than k unchanged.|{"values":[1,2,3,4,5],"k":2}|[2,1,4,3,5]|Check a complete group before reversing its pointers.
Merge K Ordered Lists|Hard|Merge all sorted linked lists into one sorted value array.|{"lists":[[1,4,5],[1,3,4],[2,6]]}|[1,1,2,3,4,4,5,6]|Put the current head of each list in a min heap.
Partition Around a Value|Medium|Move list nodes below x before nodes at least x, retaining original order within both groups.|{"values":[1,4,3,2,5,2],"x":3}|[1,2,2,4,3,5]|Build lower and upper lists, then join their tails.`,
  },
  {
    topic: "Binary Tree",
    constraints:
      "Trees use level-order JSON arrays with null for missing children; 0 ≤ nodes ≤ 10,000.",
    rows: `Tree Maximum Depth|Easy|Return the number of nodes on the longest root-to-leaf path; an empty tree has depth zero.|{"tree":[3,9,20,null,null,15,7]}|3|Depth is one plus the larger child depth.
Mirror a Binary Tree|Easy|Swap left and right children at every node; return the level-order representation without trailing nulls.|{"tree":[4,2,7,1,3,6,9]}|[4,7,2,9,6,3,1]|Visit every node and exchange its children.
Symmetric Tree|Easy|Return whether the left and right subtrees are mirror images.|{"tree":[1,2,2,3,4,4,3]}|true|Compare opposite child pairs recursively.
Tree Level Groups|Medium|Return node values grouped from root level to deepest level, left to right.|{"tree":[3,9,20,null,null,15,7]}|[[3],[9,20],[15,7]]|Process exactly one queue level at a time.
Tree Right-Side View|Medium|Return the last visible node from each level when viewed from the right.|{"tree":[1,2,3,null,5,null,4]}|[1,3,4]|Take the last value in each breadth-first level.
Root-to-Leaf Sum Paths|Medium|Return all root-to-leaf value paths summing to target, in left-first traversal order.|{"tree":[1,2,3],"target":3}|[[1,2]]|Backtrack a path and its running sum.
Tree Diameter|Medium|Return the number of edges on the longest path between any two tree nodes.|{"tree":[1,2,3,4,5]}|3|At each node, combine its two subtree heights.
Maximum Tree Path Sum|Hard|Return the maximum sum of a nonempty path between any two nodes in a nonempty tree; values may be negative.|{"tree":[-10,9,20,null,null,15,7]}|42|Clamp negative child gains to zero and track the best path through each node.
Tree Serialize and Restore|Hard|Serialize a binary tree with preorder values and # for missing children, separated by commas; return that string.|{"tree":[1,2,3]}|"1,2,#,#,3,#,#"|Null markers make a recursive encoding unambiguous.
Lowest Shared Ancestor|Medium|Node values are unique and p,q exist. Return the value of their lowest common ancestor.|{"tree":[3,5,1,6,2,0,8,null,null,7,4],"p":5,"q":1}|3|A node is the answer when targets appear in opposite subtrees.`,
  },
  {
    topic: "Binary Search Tree",
    constraints:
      "BSTs have distinct integer values and use level-order arrays with null placeholders; at most 10,000 nodes.",
    rows: `Search a BST|Easy|Return whether target exists in the binary search tree.|{"tree":[4,2,7,1,3],"target":2}|true|Each comparison selects one child subtree.
BST Range Sum|Easy|Return the sum of values in the inclusive range [low,high].|{"tree":[10,5,15,3,7,null,18],"low":7,"high":15}|32|Skip a subtree when its values are outside the range.
BST Minimum Difference|Easy|Return the smallest difference between any two values; at least two nodes exist.|{"tree":[4,2,6,1,3]}|1|Inorder traversal places neighboring values next to one another.
Validate BST Ordering|Medium|Return whether a binary tree satisfies strict BST ordering at every node.|{"tree":[5,1,4,null,null,3,6]}|false|Carry lower and upper bounds down the tree.
Kth Smallest BST Value|Medium|Return the kth smallest value; k is valid.|{"tree":[3,1,4,null,2],"k":1}|1|Stop an inorder traversal after visiting k nodes.
Sorted Array to Balanced BST|Medium|Construct a BST by choosing the lower middle element of each sorted segment. Return level order without trailing nulls.|{"nums":[1,2,3,4,5]}|[3,1,4,null,2,null,5]|Build each subtree from its segment midpoint.
BST Successor|Medium|Return the smallest tree value strictly greater than target, or null when none exists.|{"tree":[5,3,7,2,4,6,8],"target":4}|5|Remember a candidate whenever moving left from a larger value.
Repair Swapped BST Values|Hard|Exactly two BST node values were swapped. Return the corrected inorder values without changing structure.|{"tree":[3,1,4,null,null,2]}|[1,2,3,4]|Locate the two breaks in inorder ordering.
Count Distinct BST Shapes|Hard|Return the number of structurally different BSTs containing values 1 through n, for 0 ≤ n ≤ 19.|{"n":3}|5|Sum left-shape count times right-shape count for every root.
BST Greater-Value Totals|Medium|Replace each value with the sum of all original values at least that value; return level order.|{"tree":[2,1,3]}|[5,6,3]|Traverse in reverse inorder with an accumulating total.`,
  },
  {
    topic: "Heap",
    constraints:
      "1 ≤ item count ≤ 100,000; positive k is valid; numeric priorities fit 64 bits.",
    rows: `Last Stone Weight|Easy|Repeatedly smash the two largest weights; equal weights disappear, otherwise insert their difference. Return the final weight or zero.|{"stones":[2,7,4,1,8,1]}|1|Use a max heap to retrieve the two largest stones.
K Largest Numbers|Easy|Return the k largest values in descending order, including duplicates.|{"nums":[4,1,7,3,7],"k":3}|[7,7,4]|Keep a min heap of the k best values.
Minimum Rope Join Cost|Easy|Joining two ropes costs their combined length. Return the minimum total cost to join all ropes.|{"lengths":[4,3,2,6]}|29|Always combine the two shortest remaining ropes.
K Closest Points|Medium|Return k points closest to the origin, sorted by squared distance then x then y.|{"points":[[1,3],[-2,2],[2,-2]],"k":2}|[[-2,2],[2,-2]]|Use squared distances to avoid floating-point square roots.
K Smallest Cross Pairs|Medium|From two sorted arrays return k pairs with smallest sums, ordered by sum then first value then second; enough pairs exist.|{"a":[1,7,11],"b":[2,4,6],"k":3}|[[1,2],[1,4],[1,6]]|Start a heap with the smallest pair from each relevant row.
Reorganize Adjacent Letters|Medium|Rearrange lowercase letters so no adjacent ones match. Return whether such an arrangement is possible.|{"text":"aaabbc"}|true|Compare the largest frequency with the capacity of alternating positions.
Streaming Medians|Hard|Insert numbers one at a time and return the median after each insertion.|{"nums":[5,2,10,4]}|[5,3.5,5,4.5]|Balance a max heap for the lower half and min heap for the upper half.
Smallest Range Covering Lists|Hard|Return the shortest inclusive [low,high] containing at least one value from each sorted nonempty list; ties choose smaller low.|{"lists":[[4,10,15,24,26],[0,9,12,20],[5,18,22,30]]}|[20,24]|Track the current maximum while advancing the list with the minimum head.
Least CPU Intervals|Medium|Equal task letters need at least cooldown other intervals between them. Return the minimum total intervals including idle time.|{"tasks":["A","A","A","B","B","B"],"cooldown":2}|8|Arrange the highest-frequency tasks first and count forced idle gaps.
Kth Smallest Matrix Entry|Medium|Rows and columns are sorted nondecreasing. Return the kth smallest value counting duplicates.|{"matrix":[[1,5,9],[10,11,13],[12,13,15]],"k":8}|13|Merge sorted rows with a min heap.`,
  },
  {
    topic: "Graph",
    constraints:
      "Vertices are 0 through n-1; 0 ≤ n, edge count ≤ 100,000; graphs are undirected unless specified.",
    rows: `Reachable Vertices|Easy|Return sorted vertices reachable from start in an undirected graph.|{"n":5,"edges":[[0,1],[1,2],[3,4]],"start":0}|[0,1,2]|Run depth-first or breadth-first search from the starting vertex.
Count Connected Groups|Easy|Return the number of connected components, including isolated vertices.|{"n":5,"edges":[[0,1],[1,2],[3,4]]}|2|Start a traversal at every still-unvisited vertex.
Town Trust Recipient|Easy|For people numbered 1 through n, find the person trusted by every other person who trusts nobody; return -1 if absent.|{"n":3,"trust":[[1,3],[2,3]]}|3|Track incoming and outgoing trust counts.
Prerequisite Feasibility|Medium|Directed [a,b] means a must precede b. Return whether all vertices can be completed.|{"n":3,"edges":[[0,1],[1,2]]}|true|A topological traversal succeeds exactly when no directed cycle exists.
Island Count|Medium|Return the number of four-direction connected groups of 1 in a binary grid; grid dimensions are at most 300.|{"grid":[[1,1,0],[0,1,0],[1,0,1]]}|3|Flood-fill every land cell not previously visited.
Shortest Unweighted Path|Medium|Return the shortest edge count between start and end, or -1 if unreachable.|{"n":5,"edges":[[0,1],[1,2],[0,3],[3,4],[4,2]],"start":0,"end":2}|2|Breadth-first search visits vertices in distance order.
Bipartite Graph Check|Medium|Return whether vertices can be colored with two colors so adjacent vertices differ.|{"n":4,"edges":[[0,1],[1,2],[2,3],[3,0]]}|true|Color every connected component while checking neighbor conflicts.
Weighted Shortest Routes|Hard|Edges are directed [u,v,nonnegativeWeight]. Return distances from start to all vertices, with -1 for unreachable ones.|{"n":4,"edges":[[0,1,2],[0,2,5],[1,2,1],[2,3,3]],"start":0}|[0,2,3,6]|Use a priority queue and ignore outdated distance entries.
Critical Network Connections|Hard|Return sorted [u,v] bridges, with u<v, whose removal increases the component count. There are no duplicate edges.|{"n":4,"edges":[[0,1],[1,2],[2,0],[1,3]]}|[[1,3]]|Compare DFS discovery times with the lowest reachable ancestor.
Minimum Spanning Cost|Medium|Return the minimum spanning-tree cost for weighted undirected edges, or -1 if the graph is disconnected.|{"n":3,"edges":[[0,1,1],[1,2,2],[0,2,4]]}|3|Sort edges by weight and join different disjoint sets.`,
  },
  {
    topic: "Backtracking",
    constraints:
      "Use at most 15 input values for enumeration; return results in the order stated; output size is bounded by 100,000.",
    rows: `Generate Binary Strings|Easy|Return all length-n binary strings in lexicographic order; 0 ≤ n ≤ 15.|{"n":2}|["00","01","10","11"]|Append zero then one at each recursive decision.
Choose K Values|Easy|Return all ascending combinations of k distinct values from 1 through n, in lexicographic order.|{"n":4,"k":2}|[[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]]|Carry the next eligible value in the recursive state.
Letter Case Variants|Easy|Return all variants made by changing ASCII letter case, sorted lexicographically; digits remain unchanged.|{"text":"a1b"}|["A1B","A1b","a1B","a1b"]|Branch on letters and keep digits fixed.
All Distinct Permutations|Medium|Return every permutation of distinct integers, sorted lexicographically.|{"nums":[1,2,3]}|[[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]|Mark used indices and undo the mark after recursion.
Unique Subsets|Medium|Return all distinct subsets as ascending arrays, sorted lexicographically, with the empty subset first.|{"nums":[1,2,2]}|[[],[1],[1,2],[1,2,2],[2],[2,2]]|Sort first and skip repeated sibling choices.
Unlimited Combination Sum|Medium|Return ascending combinations summing to target from distinct positive candidates; reuse is allowed. Sort combinations lexicographically.|{"candidates":[2,3,6,7],"target":7}|[[2,2,3],[7]]|Reuse the current candidate while the remaining sum is nonnegative.
Balanced Parentheses Generation|Medium|Return all balanced strings containing n pairs in lexicographic order.|{"n":3}|["((()))","(()())","(())()","()(())","()()()"]|Add a close only when an unmatched open exists.
N Queens Count|Hard|Return the number of ways to place n queens on an n-by-n board without shared rows, columns or diagonals; 1 ≤ n ≤ 12.|{"n":4}|2|Place one queen per row while tracking columns and diagonals.
Word Grid Search|Medium|Return whether a word can be traced by four-direction adjacent grid letters, using each cell at most once.|{"board":[["A","B","C"],["D","E","F"]],"word":"ABEF"}|true|Temporarily mark each path cell visited and restore it on return.
Minimum Palindrome Partition Cuts|Hard|Return the fewest cuts separating a text into palindromic pieces; length is at most 500.|{"text":"aab"}|1|Precompute palindromic spans and minimize cuts for each prefix.`,
  },
  {
    topic: "Dynamic Programming",
    constraints:
      "Numeric answers fit 64 bits; sequence lengths are at most 1,000 unless the prompt states a smaller bound.",
    rows: `Ways to Climb Steps|Easy|Count ways to climb n steps using jumps of one or two; 0 ≤ n ≤ 90, with one way for zero steps.|{"n":5}|8|The last jump comes from the preceding one or two steps.
Minimum Stair Cost|Easy|A cost array charges each stepped-on stair. Start at index 0 or 1 and move one or two steps; return minimum cost to reach beyond the last stair.|{"cost":[10,15,20]}|15|Keep the minimum total for reaching the last two positions.
Nonadjacent House Value|Easy|Return the maximum sum of selected nonnegative values where adjacent indices cannot both be selected.|{"values":[2,7,9,3,1]}|12|Compare skipping a value with taking it after the best result two places back.
Fewest Coins for Amount|Medium|Return the minimum number of positive-denomination coins needed for amount with unlimited reuse, or -1.|{"coins":[1,2,5],"amount":11}|3|Minimize one plus the result for amount minus each coin.
Longest Increasing Subsequence|Medium|Return the length of the longest strictly increasing subsequence.|{"nums":[10,9,2,5,3,7,101,18]}|4|Track the smallest possible tail for each subsequence length.
Longest Common Subsequence|Medium|Return the longest common subsequence length of two strings.|{"a":"abcde","b":"ace"}|3|Matching characters extend a diagonal state; otherwise take the best neighboring state.
Equal-Sum Partition|Medium|Return whether positive values can be divided into two groups with equal sum; total sum ≤ 20,000.|{"nums":[1,5,11,5]}|true|A half-total subset can be found with a backwards-updated boolean table.
Edit Distance|Hard|Return the fewest insertions, deletions or replacements to transform a into b.|{"a":"horse","b":"ros"}|3|Compare three neighboring prefix states for unequal characters.
Burst Balloon Reward|Hard|Burst each balloon once; its reward is current left value times itself times current right value, with outer boundaries 1. Return maximum total; length ≤ 300.|{"nums":[3,1,5,8]}|167|Choose the last balloon in each interval so its neighbors stay fixed.
Grid Path Count|Medium|Count routes from top-left to bottom-right moving only right or down through open cells; 1 marks a blocked cell.|{"grid":[[0,0,0],[0,1,0],[0,0,0]]}|2|Each open cell receives ways from its top and left neighbors.`,
  },
  {
    topic: "Greedy",
    constraints:
      "0 ≤ collection length ≤ 100,000; all costs and capacities are nonnegative unless specified.",
    rows: `Assign Cookies Fairly|Easy|Each child needs at least its greed value in cookie size and each cookie serves one child. Return the most children satisfied.|{"greed":[1,2,3],"cookies":[1,1]}|1|Match the smallest usable cookie to the least demanding remaining child.
Lemonade Change|Easy|Each purchase costs 5 and customers pay 5, 10 or 20. Starting without cash, return whether every customer can receive change.|{"bills":[5,5,5,10,20]}|true|Prefer a ten plus a five when giving fifteen in change.
Best One-Trade Profit|Easy|Return the greatest nonnegative profit from buying once then selling on a later day.|{"prices":[7,1,5,3,6,4]}|5|Track the cheapest price seen before each selling day.
Can Reach the Last Index|Medium|Each nonnegative array entry gives the maximum forward jump from that index. Return whether the last index is reachable.|{"nums":[2,3,1,1,4]}|true|Track the furthest reachable index while scanning.
Fewest Jumps to the End|Medium|Return the fewest jumps to reach the last index, or -1 if impossible; entries are maximum forward jump lengths.|{"nums":[2,3,1,1,4]}|2|Expand reachable layers as in breadth-first search.
Circular Fuel Start|Medium|Return the smallest station index allowing a full circuit, consuming cost[i] to reach the next station, or -1.|{"gas":[1,2,3,4,5],"cost":[3,4,5,1,2]}|3|Reset a candidate after a negative running fuel balance; check total fuel first.
Partition Character Labels|Medium|Split text into the most consecutive parts such that a character appears in only one part; return part lengths.|{"text":"ababcbacadefegdehijhklij"}|[9,7,8]|Close a part when reaching the greatest last occurrence seen so far.
Minimum Candies|Hard|Give every child at least one candy and more than any adjacent child with a lower rating. Return the minimum total.|{"ratings":[1,0,2]}|5|Combine increasing requirements from left and right passes.
Maximum Courses Before Deadlines|Hard|Courses are [duration,deadline]; take them sequentially from day zero. Return the most courses finishable by their deadlines.|{"courses":[[100,200],[200,1300],[1000,1250],[2000,3200]]}|3|Sort by deadline and remove the longest selected course when time overflows.
Remove Overlapping Intervals|Medium|Intervals are half-open. Return the fewest intervals to remove so the rest do not overlap.|{"intervals":[[1,2],[2,3],[3,4],[1,3]]}|1|Keep the interval that finishes earliest whenever choices overlap.`,
  },
  {
    topic: "Bit Manipulation",
    constraints:
      "Use unsigned 32-bit integers for bit operations; array examples represent ordinary integers; results fit 64 bits.",
    rows: `Unique Unpaired Value|Easy|Every integer occurs twice except one. Return the unpaired value.|{"nums":[4,1,2,1,2]}|4|XOR cancels matching pairs.
Count Set Bits|Easy|Return the number of one bits in unsigned integer n.|{"n":11}|3|Repeatedly clear the lowest set bit.
Power of Two Check|Easy|Return whether positive integer n is an exact power of two.|{"n":16}|true|A power of two has exactly one set bit.
Bit Counts Through N|Medium|Return set-bit counts for every integer from zero through n; 0 ≤ n ≤ 100,000.|{"n":5}|[0,1,1,2,1,2]|Use the count for n shifted right plus its last bit.
Two Unpaired Values|Medium|Every value occurs twice except two distinct values. Return those two in ascending order.|{"nums":[1,2,1,3,2,5]}|[3,5]|A set bit of the combined XOR separates the two values.
Missing Value From Zero to N|Medium|An array of n distinct numbers contains values from zero to n with one missing. Return that value.|{"nums":[3,0,1]}|2|XOR all indices and values, including n.
Range Bitwise AND|Medium|Return the bitwise AND of every integer in the inclusive range [left,right].|{"left":5,"right":7}|4|Keep only the common binary prefix.
Maximum Pair XOR|Hard|Return the greatest XOR from any pair of distinct array positions; at least two values exist.|{"nums":[3,10,5,25,2,8]}|28|Build a bit trie and prefer the opposite bit at every level.
Smallest Sufficient Skill Team|Hard|Return the minimum number of people covering all required skills; up to 16 skills, and coverage is possible.|{"skills":["java","node","react"],"people":[["java"],["node"],["node","react"]]}|2|Represent covered skills as a bitmask and minimize team size for each mask.
Total Pair Hamming Distance|Medium|Return the sum of differing bit positions across all unordered value pairs.|{"nums":[4,14,2]}|6|At each bit position, contribute ones times zeros.`,
  },
  {
    topic: "Math",
    constraints:
      "Use integers; inputs and results fit signed 64-bit arithmetic unless explicitly bounded differently.",
    rows: `Greatest Common Divisor|Easy|Return the nonnegative greatest common divisor of a and b; at least one is nonzero.|{"a":48,"b":18}|6|Use repeated remainder operations.
Prime Number Check|Easy|Return whether n is prime; 0 ≤ n ≤ 10^9.|{"n":29}|true|Test divisors only up to the square root.
Digit Sum|Easy|Return the sum of decimal digits of nonnegative n.|{"n":9051}|15|Repeatedly take the last digit and remove it.
Fast Modular Power|Medium|Return base raised to exponent modulo modulus, with exponent ≥ 0 and modulus ≥ 1.|{"base":2,"exponent":10,"modulus":1000}|24|Square the base while halving the exponent.
Count Primes Below N|Medium|Return the number of primes strictly below n; 0 ≤ n ≤ 5,000,000.|{"n":10}|4|Use a sieve starting each prime's multiples at its square.
Recurring Fraction Text|Medium|Return numerator/denominator as decimal text, enclosing a recurring cycle in parentheses. Denominator is nonzero.|{"numerator":1,"denominator":3}|"0.(3)"|Remember the output position of each long-division remainder.
Spreadsheet Column Label|Medium|Convert positive n into spreadsheet labels A through Z, AA and so on.|{"n":28}|"AB"|Use a one-based base-26 representation.
Nth Digit in the Number Stream|Hard|In the text 123456789101112..., return the digit at one-based position n; 1 ≤ n ≤ 10^12.|{"n":11}|0|Subtract whole blocks with equal digit width, then identify the number and offset.
Rectangle Union Area|Hard|Return the union area of axis-aligned rectangles [x1,y1,x2,y2] with x1<x2,y1<y2; at most 200 rectangles.|{"rectangles":[[0,0,2,2],[1,1,3,3]]}|7|Sweep sorted x boundaries and merge active y intervals.
Minimum Perfect Squares|Medium|Return the fewest perfect-square positive integers that sum to n; 1 ≤ n ≤ 10,000.|{"n":12}|3|Treat square values as reusable denominations in a minimum-count DP.`,
  },
];

const aliases: Record<string, string> = {
  "Squares of a Sorted Array": "sorted-squares",
};
export const codingLanguages = [
  "Python",
  "JavaScript",
  "TypeScript",
  "C",
  "C++",
  "Java",
  "C#",
  "Go",
  "Rust",
  "Ruby",
  "PHP",
  "Swift",
  "Kotlin",
  "Scala",
  "R",
  "Dart",
];
function starterCode(title: string) {
  return Object.fromEntries(
    codingLanguages.map((language) => [
      language,
      language === "Python"
        ? `def solve(data):\n    """${title}. Input is the JSON object in the description."""\n    pass\n`
        : language === "JavaScript"
          ? `function solve(data) {\n  // ${title}\n  // Return the result for the JSON input object.\n}\n`
          : language === "TypeScript"
            ? `function solve(data: unknown): unknown {\n  // ${title}\n  return undefined;\n}\n`
            : `// ${language}: ${title}\n// Accept the JSON input shown in the description.\n// Implement your algorithm and return the specified result.\n`,
    ]),
  );
}
export const codingCatalog: PracticeAssessment[] = groups.flatMap(
  (group, groupIndex) =>
    group.rows.split("\n").map((row, rowIndex) => {
      const [title, difficulty, statement, input, output, hint] =
        row.split("|");
      const slug =
        aliases[title] ||
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-$/, "");
      return {
        id: slug,
        number: groupIndex * 10 + rowIndex + 1,
        title,
        description: statement,
        category: "coding" as const,
        kind: "coding" as const,
        difficulty: difficulty as PracticeAssessment["difficulty"],
        durationMinutes:
          difficulty === "Hard" ? 45 : difficulty === "Medium" ? 30 : 20,
        sample: true as const,
        topics: [group.topic],
        problem: {
          statement: `${statement} Implement solve(data), where data is the JSON object shown below. Return the result in the displayed output format.`,
          examples: [
            {
              input,
              output,
              explanation: `This sample illustrates the required input and return format for ${title.toLowerCase()}.`,
            },
          ],
          constraints: [
            group.constraints,
            "Respect the prompt's ordering and tie-breaking rules. An example is illustrative; consider edge cases too.",
          ],
          starterCode: starterCode(title),
          hints: [
            hint,
            `Describe your ${group.topic.toLowerCase()} invariant before writing code. Check empty or smallest valid input, boundaries and repeated values where permitted.`,
          ],
          approach: `${hint} Work through the sample by hand, identify the state you need to retain, then derive the time and space costs. Check the stated limits before choosing a brute-force approach.`,
        },
      };
    }),
);
