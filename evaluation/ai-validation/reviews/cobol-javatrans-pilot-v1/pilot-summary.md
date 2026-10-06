# COBOL-JavaTrans Human Review Pilot v1

- Pilot: `cobol-javatrans-pilot-v1`
- Source dataset: `COBOL_JAVATRANS`
- Eligible candidates: 143
- Selected candidates: 15
- Size strata: 5 SMALL, 5 MEDIUM, 5 LARGE
- Selection hash: `4e410cbe0c81aea46f9af3832efe0ea1739f7df49686ff27d4c80251f92d4ce7`

Size strata describe source-plus-target character count only. They do not express semantic difficulty.
Upstream tests are evidence only and never establish ALSM human approval.

## external-cjt-humaneval-102

- Size stratum: SMALL (1451 characters)
- COBOL source: `source/humaneval-102.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-102.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (8 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `c98a1e0d621d3f17dfe747d71cb092a40f0faab3682a8c281dbd0b72a288406e`
- Java SHA-256: `57f5b4dcbb355e7d5d0fb268c50b9cf9620632e694661456cc868590a8fa29c0`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/102`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: This function takes two positive numbers x and y and returns the biggest even integer number that is in the range [x, y] inclusive. If there's no such number, then the function should return -1. For example: chooseNum(12, 15) = 14 chooseNum(13, 12) = -1

## external-cjt-humaneval-55

- Size stratum: SMALL (1748 characters)
- COBOL source: `source/humaneval-55.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-55.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (5 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `d5131a70803c35822294b8ee804e15a0be6fd108af5e48927b13bae299e0b417`
- Java SHA-256: `4c7750a00c992a025913f62c663fcccdd258185528e5bf0dc6315ca2095eec16`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/55`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Return n-th Fibonacci number. 55 1 21

## external-cjt-humaneval-100

- Size stratum: SMALL (2359 characters)
- COBOL source: `source/humaneval-100.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-100.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (5 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `9ca644127839ab461626aa4907b014db998135839b6323211682bb07419d93e0`
- Java SHA-256: `7747b684f8b0319d6f97b8b8574d33f318a577325de56be48fad289bdd7c6dd4`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/100`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Given a positive integer n, you have to make a pile of n levels of stones. The first level has n stones. The number of stones in the next level is: - the next odd number if n is odd. - the next even number if n is even. Return the number of stones in each level in a list, where element at index i represents the number of stones in the level (i+1). Examples: [3, 5, 7]

## external-cjt-humaneval-83

- Size stratum: SMALL (1874 characters)
- COBOL source: `source/humaneval-83.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-83.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (5 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `953aaf2d4d9b317e134f17eb88908d154795c0bfce3cebb47e23ec0b940fc06a`
- Java SHA-256: `39298ac4274ab658390421ca8cfecfcdecc6b880758c751393da865add6d8804`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/83`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Given a positive integer n, return the count of the numbers of n-digit positive integers that start or end with 1.

## external-cjt-humaneval-131

- Size stratum: SMALL (2252 characters)
- COBOL source: `source/humaneval-131.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-131.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (7 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `15b12a2d8022a9d0f72d0ff3a584fd81620eb37156c660b2c74ea24f941dba43`
- Java SHA-256: `b1e3e423ad4aac46be936fad029022fc757b062232f723c5b1dd2bcb7497b922`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/131`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Given a positive integer n, return the product of the odd digits. Return 0 if all digits are even. For example: digits(1)  == 1 digits(4)  == 0 digits(235) == 15

## external-cjt-humaneval-63

- Size stratum: MEDIUM (2700 characters)
- COBOL source: `source/humaneval-63.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-63.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (7 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `2c256de82cd820b702808a128113d1e26e9712a173de5a7d8e880089d74e529c`
- Java SHA-256: `389f385cf8eae3d596470ec8becb11d3b18d084aae76d77fe6f9657eee9ecc53`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/63`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: The FibFib number sequence is a sequence similar to the Fibbonacci sequnece that's defined as follows: fibfib(0) == 0 fibfib(1) == 0 fibfib(2) == 1 fibfib(n) == fibfib(n-1) + fibfib(n-2) + fibfib(n-3). Please write a function to efficiently compute the n-th element of the fibfib number sequence. 0 4 24

## external-cjt-humaneval-88

- Size stratum: MEDIUM (3320 characters)
- COBOL source: `source/humaneval-88.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-88.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (3 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `d3a25d0646ea150b9b2fed2728a5d6d8ebfaf73894f36129a7f52c328500eb2a`
- Java SHA-256: `25e7de015795c5957b79bd7528c6ffab5d580a7d552163bb18fbc4a438e104f1`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/88`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Given an array of non-negative integers, return a copy of the given array after sorting, you will sort the given array in ascending order if the sum( first index value, last index value) is odd, or sort it in descending order if the sum( first index value, last index value) is even. Note: don't change the given array. Examples: sortArray(Arrays.asList()) => [] sortArray(Arrays.asList(5)) => [5] sortArray(Arrays.asList(2, 4, 3, 0, 1, 5)) => [0, 1, 2, 3, 4, 5] sortArray(Arrays.asList(2, 4, 3, 0, 1, 5, 6)) => [6, 5, 4, 3, 2, 1, 0]

## external-cjt-humaneval-68

- Size stratum: MEDIUM (3365 characters)
- COBOL source: `source/humaneval-68.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-68.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (7 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `ed247f0c60e73cc0d3050f8d405bd31b8a7b0a53d8dec681fcc083cac2599d1c`
- Java SHA-256: `61abd3da9c39af883e75b44e2ff9aefb88fed8828a81985be8d8e113fb93d477`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/68`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: "Given an array representing a branch of a tree that has non-negative integer nodes your task is to pluck one of the nodes and return it. The plucked node should be the node with the smallest even value. If multiple nodes with the same smallest even value are found return the node that has smallest index. The plucked node should be returned in a list, [ smalest_value, its index ], If there are no even values or the given array is empty, return []. Example 1: Input: [4,2,3] Output: [2, 1] Explanation: 2 has the smallest even value, and 2 has the smallest index. Example 2: Input: [1,2,3] Output: [2, 1] Explanation: 2 has the smallest even value, and 2 has the smallest index. Example 3: Input: [] Output: [] Example 4: Input: [5, 0, 3, 0, 4, 2] Output: [0, 1] Explanation: 0 is the smallest value, but  there are two zeros, so we will choose the first zero, which has the smallest index. Constraints: 1 <= nodes.length <= 10000 0 <= node.value

## external-cjt-humaneval-93

- Size stratum: MEDIUM (3419 characters)
- COBOL source: `source/humaneval-93.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-93.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (5 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `752a1295928e52b920456f86acfab88cfb60db61a454498f91ff397e61749fb5`
- Java SHA-256: `62d085cc4d6bc614adb0e1beeea5bc12c3508b5583b97bee2982ce3c580c888f`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/93`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Write a function that takes a message, and encodes in such a way that it swaps case of all letters, replaces all vowels in the message with the letter that appears 2 places ahead of that vowel in the english alphabet. Assume only letters. Examples: "TGST" "tHKS KS C MGSSCGG"

## external-cjt-humaneval-146

- Size stratum: MEDIUM (3400 characters)
- COBOL source: `source/humaneval-146.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-146.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (3 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `1470dd135b5232dc7dde0669b478c2929273f66c3292c5348c17f0ae4d476026`
- Java SHA-256: `560c673629f2146f22729dbb587cc2d37e80b09bf519c5b2c171f6032f578f3d`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/146`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Write a function that takes an array of numbers as input and returns the number of elements in the array that are greater than 10 and both first and last digits of a number are odd (1, 3, 5, 7, 9). For example: specialFilter(Arrays.asList(15, -73, 14, -15)) => 1 specialFilter(Arrays.asList(33, -2, -3, 45, 21, 109)) => 2

## external-cjt-humaneval-159

- Size stratum: LARGE (3604 characters)
- COBOL source: `source/humaneval-159.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-159.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (6 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `19342c5fdef87f77a42ba92f657b25aaa56e1c882b3f982601c2311bf2e647b3`
- Java SHA-256: `f34e646cfd4c46cd5a676986f1db7f0b752b4f0e763779230a970e65fffdfd5e`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/159`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: You're a hungry rabbit, and you already have eaten a certain number of carrots, but now you need to eat more carrots to complete the day's meals. you should return an array of [ total number of eaten carrots after your meals, the number of carrots left after your meals ] if there are not enough remaining carrots, you will eat all remaining carrots, but will still be hungry. Example: eat(5, 6, 10) -> [11, 4] eat(4, 8, 9) -> [12, 1] eat(1, 10, 10) -> [11, 0] eat(2, 11, 5) -> [7, 0] Variables: @number : integer the number of carrots that you have eaten. @need : integer the number of carrots that you need to eat. @remaining : integer the number of remaining carrots thet exist in stock Constrain: 0 <= number <= 1000 0 <= need <= 1000 0 <= remaining <= 1000 Have fun :)

## external-cjt-humaneval-158

- Size stratum: LARGE (3475 characters)
- COBOL source: `source/humaneval-158.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-158.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (4 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `0c50c54e8553817867679d51dae528a6ced1177a0d49a1df4de6d1a6339cea27`
- Java SHA-256: `398e1b2bd2b50d9a3826498fe49bf6da117e48887fa95440c25b886ea361eda8`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/158`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Write a function that accepts a list of strings. The list contains different words. Return the word with maximum number of unique characters. If multiple strings have maximum number of unique characters, return the one which comes first in lexicographical order. findMax(["name", "of", "string"]) == "string" findMax(["name", "enam", "game"]) == "enam" findMax(["aaaaaaa", "bb" ,"cc"]) == ""aaaaaaa"

## external-cjt-humaneval-130

- Size stratum: LARGE (3829 characters)
- COBOL source: `source/humaneval-130.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-130.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (10 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `d5909342d7710e7c6d964aa6666d8685ad0c0fa2e91cc9c4d9598474d163ea32`
- Java SHA-256: `d813b70ef756ef2c476e56a9229d52c334b52fc3864e2958e6c485e5449f36ca`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/130`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Everyone knows Fibonacci sequence, it was studied deeply by mathematicians in the last couple centuries. However, what people don't know is Tribonacci sequence. Tribonacci sequence is defined by the recurrence: tri(1) = 3 tri(n) = 1 + n / 2, if n is even. tri(n) =  tri(n - 1) + tri(n - 2) + tri(n + 1), if n is odd. For example: tri(2) = 1 + (2 / 2) = 2 tri(4) = 3 tri(3) = tri(2) + tri(1) + tri(4) = 2 + 3 + 3 = 8 You are given a non-negative integer number n, you have to a return a list of the first n + 1 numbers of the Tribonacci sequence. Examples: tri(3) = [1, 3, 2, 8]

## external-cjt-humaneval-123

- Size stratum: LARGE (4323 characters)
- COBOL source: `source/humaneval-123.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-123.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (4 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `f9628e056b96d4cd52636c1edf705a5d35cb85b2fc4023999eb5233634f090eb`
- Java SHA-256: `bdb9d0c34e06680eb45bd6a626598cebb4f4a869d6bc8bc0fd217b9285c99c68`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/123`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: Given a positive integer n, return a sorted list that has the odd numbers in collatz sequence. The Collatz conjecture is a conjecture in mathematics that concerns a sequence defined as follows: start with any positive integer n. Then each term is obtained from the previous term as follows: if the previous term is even, the next term is one half of the previous term. If the previous term is odd, the next term is 3 times the previous term plus 1. The conjecture is that no matter what value of n, the sequence will always reach 1. Note: 1. Collatz(1) is [1]. 2. returned list sorted in increasing order. For example: getOddCollatz(5) returns [1, 5] # The collatz sequence for 5 is [5, 16, 8, 4, 2, 1], so the odd numbers are only 1, and 5.

## external-cjt-humaneval-109

- Size stratum: LARGE (5590 characters)
- COBOL source: `source/humaneval-109.cbl` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Java target: `target/humaneval-109.java` in `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`
- Context compatibility: COMPATIBLE
- Upstream test evidence: present (3 structured COBOL test(s); Java test source present)
- COBOL SHA-256: `9fa50628319fd3139cdab274be5b45a0d8aeaf25df8b87f3efec73adb55ea9ec`
- Java SHA-256: `6d497d0d80e11a5b4c929e8a2a232002b9622cf6f0a83dff26e031c4619fde93`
- Provenance: `COBOL-Coder/COBOL-Coder@2b14b7bf7e55556205654c6f7657fa60e36251fa`, `evaluation/data/COBOL-JavaTrans.jsonl`, case `HumanEval/109`
- License evidence: `Apache-2.0` at `LICENSE.upstream.txt`
- Task/problem description: We have an array 'arr' of N integers arr[1], arr[2], ..., arr[N].The numbers in the array will be randomly ordered. Your task is to determine if it is possible to get an array sorted in non-decreasing order by performing the following operation on the given array: You are allowed to perform right shift operation any number of times. One right shift operation means shifting all elements of the array by one position in the right direction. The last element of the array will be moved to the starting position in the array i.e. 0th index. If it is possible to obtain the sorted array by performing the above operation then return true else return False. If the given array is empty then return true. Note: The given list is guaranteed to have unique elements. For Example: moveOneBall(Arrays.asList(3, 4, 5, 1, 2))==>true Explanation: By performin 2 right shift operations, non-decreasing order can be achieved for the given array. moveOneBall(Arrays.asList(3, 5, 4, 1, 2))==>False Explanation:It is not possible to get non-decreasing order for the given array by performing any number of right shift operations.
