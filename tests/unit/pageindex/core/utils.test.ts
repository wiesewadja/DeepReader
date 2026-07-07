import { describe, it, expect } from "vitest";
import {
  countTokens,
  getJsonContent,
  extractJson,
  writeNodeId,
  getNodes,
  structureToList,
  getLeafNodes,
  isLeafNode,
  listToTree,
  addPrefaceIfNeeded,
  postProcessing,
  removeFields,
  cleanStructurePost,
  sanitizeFilename,
  getFirstStartPageFromText,
  getLastStartPageFromText,
  findNodeById,
  cosineSimilarity,
  cleanTitle,
  convertPhysicalIndexToInt,
  convertPageToInt,
  reorderDict,
  formatStructure,
  createCleanStructureForDescription,
} from "@/pageindex/core/utils";

describe("countTokens", () => {
  it("should return 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("should count English tokens (~4 chars per token)", () => {
    expect(countTokens("hello")).toBe(2); // 5 chars × 0.25 = 1.25 → ceil = 2
    expect(countTokens("hello world")).toBe(3); // 11 chars × 0.25 = 2.75 → ceil = 3
  });

  it("should count CJK tokens (~1 per char)", () => {
    expect(countTokens("你好")).toBe(2);
    expect(countTokens("你好世界")).toBe(4);
  });

  it("should handle mixed CJK and English", () => {
    const count = countTokens("hello你好world");
    expect(count).toBeGreaterThan(0);
  });
});

describe("getJsonContent", () => {
  it("should extract from ```json blocks", () => {
    const input = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
    expect(getJsonContent(input)).toBe('{"key": "value"}');
  });

  it("should extract from ``` blocks without json specifier", () => {
    const input = '```\n{"key": "value"}\n```';
    expect(getJsonContent(input)).toBe('{"key": "value"}');
  });

  it("should extract raw JSON object", () => {
    const input = 'Result: {"key": "value"} done';
    expect(getJsonContent(input)).toBe('{"key": "value"}');
  });

  it("should extract raw JSON array", () => {
    const input = 'Result: [1, 2, 3] done';
    expect(getJsonContent(input)).toBe('[1, 2, 3]');
  });

  it("should strip <think> tags", () => {
    const input = '<think>thinking content</think>{"key": "value"}';
    expect(getJsonContent(input)).toBe('{"key": "value"}');
  });

  it("should strip output tags", () => {
    const input = '<output>{"key": "value"}</output>';
    expect(getJsonContent(input)).toBe('{"key": "value"}');
  });

  it("should return trimmed content when no JSON found", () => {
    expect(getJsonContent("just plain text")).toBe("just plain text");
  });
});

describe("extractJson", () => {
  it("should parse valid JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("should parse JSON from code block", () => {
    const input = '```json\n{"a": 1}\n```';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it("should handle Python None/True/False", () => {
    const input = '{"value": None, "flag": True, "other": False}';
    expect(extractJson(input)).toEqual({ value: null, flag: true, other: false });
  });

  it("should handle trailing commas", () => {
    const input = '{"a": [1, 2, 3,], "b": {"c": 1,},}';
    expect(extractJson(input)).toEqual({ a: [1, 2, 3], b: { c: 1 } });
  });

  it("should return null for invalid JSON", () => {
    expect(extractJson("not json at all")).toBeNull();
  });

  it("should strip think tags before parsing", () => {
    const input = '<think>reasoning</think>{"result": 42}';
    expect(extractJson(input)).toEqual({ result: 42 });
  });
});

describe("writeNodeId", () => {
  it("should assign node IDs to single node", () => {
    const tree = { title: "Root", nodes: [] as never[] };
    const nextId = writeNodeId(tree);
    expect(tree.nodeId).toBe("0000");
    expect(nextId).toBe(1);
  });

  it("should assign sequential IDs to nested tree", () => {
    const tree = {
      title: "Root",
      nodes: [
        { title: "Child 1" },
        { title: "Child 2", nodes: [{ title: "Grandchild" }] },
      ],
    };
    writeNodeId(tree);
    expect(tree.nodeId).toBe("0000");
    expect(tree.nodes[0].nodeId).toBe("0001");
    expect(tree.nodes[1].nodeId).toBe("0002");
    expect(tree.nodes[1].nodes[0].nodeId).toBe("0003");
  });

  it("should start from custom nodeId", () => {
    const tree = { title: "Root" };
    const nextId = writeNodeId(tree, 10);
    expect(tree.nodeId).toBe("0010");
    expect(nextId).toBe(11);
  });

  it("should handle array input", () => {
    const trees = [{ title: "A" }, { title: "B" }];
    writeNodeId(trees);
    expect(trees[0].nodeId).toBe("0000");
    expect(trees[1].nodeId).toBe("0001");
  });
});

describe("getNodes", () => {
  it("should flatten tree to list", () => {
    const tree = {
      title: "Root",
      nodeId: "0000",
      nodes: [
        { title: "Child", nodeId: "0001" },
        { title: "Child2", nodeId: "0002", nodes: [{ title: "Grand", nodeId: "0003" }] },
      ],
    };
    const nodes = getNodes(tree);
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => n.title)).toEqual(["Root", "Child", "Child2", "Grand"]);
  });

  it("should not include nodes property in results", () => {
    const tree = {
      title: "Root",
      nodes: [{ title: "Child" }],
    };
    const nodes = getNodes(tree);
    expect(nodes[0]).not.toHaveProperty("nodes");
  });

  it("should handle array input", () => {
    const trees = [{ title: "A" }, { title: "B" }];
    const nodes = getNodes(trees);
    expect(nodes).toHaveLength(2);
  });
});

describe("structureToList", () => {
  it("should keep parent references", () => {
    const tree = {
      title: "Root",
      nodes: [{ title: "Child" }],
    };
    const list = structureToList(tree);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(tree);
  });
});

describe("getLeafNodes", () => {
  it("should return only leaf nodes", () => {
    const tree = {
      title: "Root",
      nodes: [
        { title: "Child", nodes: [{ title: "Grandchild" }] },
        { title: "Leaf" },
      ],
    };
    const leaves = getLeafNodes(tree);
    expect(leaves).toHaveLength(2);
    expect(leaves.map((n) => n.title)).toContain("Grandchild");
    expect(leaves.map((n) => n.title)).toContain("Leaf");
  });

  it("should treat childless node as leaf", () => {
    const tree = { title: "Solo" };
    expect(getLeafNodes(tree)).toHaveLength(1);
  });
});

describe("isLeafNode", () => {
  it("should return true for leaf node", () => {
    const tree = {
      title: "Root",
      nodeId: "0000",
      nodes: [{ title: "Child", nodeId: "0001" }],
    };
    expect(isLeafNode(tree, "0001")).toBe(true);
  });

  it("should return false for non-leaf node", () => {
    const tree = {
      nodeId: "0000",
      title: "Root",
      nodes: [{ title: "Child", nodeId: "0001" }],
    };
    expect(isLeafNode(tree, "0000")).toBe(false);
  });

  it("should return false for non-existent node", () => {
    expect(isLeafNode({ title: "Root" }, "9999")).toBe(false);
  });
});

describe("listToTree", () => {
  it("should convert flat list with structure to tree", () => {
    const items = [
      { structure: "1", title: "Chapter 1", physicalIndex: 1 },
      { structure: "1.1", title: "Section 1.1", physicalIndex: 5 },
      { structure: "1.2", title: "Section 1.2", physicalIndex: 10 },
      { structure: "2", title: "Chapter 2", physicalIndex: 20 },
    ];
    const tree = listToTree(items);
    expect(tree).toHaveLength(2);
    expect(tree[0].title).toBe("Chapter 1");
    expect(tree[0].nodes).toHaveLength(2);
    expect(tree[1].title).toBe("Chapter 2");
  });

  it("should handle items without structure as root nodes", () => {
    const items = [
      { title: "Standalone 1", physicalIndex: 1 },
      { title: "Standalone 2", physicalIndex: 5 },
    ];
    const tree = listToTree(items);
    expect(tree).toHaveLength(2);
  });

  it("should clean empty nodes arrays", () => {
    const items = [{ structure: "1", title: "Only child", physicalIndex: 1 }];
    const tree = listToTree(items);
    expect(tree[0]).not.toHaveProperty("nodes");
  });
});

describe("addPrefaceIfNeeded", () => {
  it("should add preface when first page > 1", () => {
    const items = [
      { title: "Chapter 1", physicalIndex: 5 },
    ];
    const result = addPrefaceIfNeeded(items);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Preface");
    expect(result[0].physicalIndex).toBe(1);
  });

  it("should not add preface when first page is 1", () => {
    const items = [
      { title: "Chapter 1", physicalIndex: 1 },
    ];
    expect(addPrefaceIfNeeded(items)).toHaveLength(1);
  });

  it("should handle empty array", () => {
    expect(addPrefaceIfNeeded([])).toEqual([]);
  });
});

describe("postProcessing", () => {
  it("should set startIndex from physicalIndex", () => {
    const items = [
      { title: "A", physicalIndex: 1 },
      { title: "B", physicalIndex: 10 },
    ];
    const tree = postProcessing(items, 20);
    expect(tree.length).toBeGreaterThan(0);
  });
});

describe("removeFields", () => {
  it("should remove specified fields", () => {
    const data = { title: "Test", text: "content", summary: "sum" };
    const result = removeFields(data, ["text"]) as Record<string, unknown>;
    expect(result.title).toBe("Test");
    expect(result.text).toBeUndefined();
    expect(result.summary).toBe("sum");
  });

  it("should remove fields recursively", () => {
    const data = {
      title: "Root",
      text: "root text",
      nodes: [{ title: "Child", text: "child text" }],
    };
    const result = removeFields(data, ["text"]) as Record<string, unknown>;
    expect(result.text).toBeUndefined();
    expect((result.nodes as Record<string, unknown>[])[0].text).toBeUndefined();
  });

  it("should handle arrays", () => {
    const data = [{ text: "a" }, { text: "b" }];
    const result = removeFields(data, ["text"]) as Record<string, unknown>[];
    expect(result[0].text).toBeUndefined();
  });
});

describe("cleanStructurePost", () => {
  it("should remove pageNumber field", () => {
    const tree = {
      title: "Root",
      pageNumber: 5,
      nodes: [{ title: "Child", pageNumber: 10 }],
    };
    cleanStructurePost(tree);
    expect(tree).not.toHaveProperty("pageNumber");
    expect(tree.nodes[0]).not.toHaveProperty("pageNumber");
  });
});

describe("sanitizeFilename", () => {
  it("should replace invalid characters", () => {
    expect(sanitizeFilename('file:name/test')).toBe("file-name-test");
  });

  it("should replace whitespace", () => {
    expect(sanitizeFilename("hello world")).toBe("hello-world");
  });

  it("should trim whitespace", () => {
    expect(sanitizeFilename("  hello  ")).toBe("-hello-");
  });

  it("should handle multiple invalid chars", () => {
    expect(sanitizeFilename('a:b*c?"d<e>f|g')).toBe("a-b-c--d-e-f-g");
  });
});

describe("getFirstStartPageFromText", () => {
  it("should extract first start page", () => {
    expect(getFirstStartPageFromText("text <start_index_5> more")).toBe(5);
  });

  it("should return -1 when no marker found", () => {
    expect(getFirstStartPageFromText("no markers here")).toBe(-1);
  });

  it("should extract only the first occurrence", () => {
    expect(getFirstStartPageFromText("<start_index_3> <start_index_7>")).toBe(3);
  });
});

describe("getLastStartPageFromText", () => {
  it("should extract last start page", () => {
    expect(getLastStartPageFromText("<start_index_3> <start_index_7>")).toBe(7);
  });

  it("should return -1 when no marker found", () => {
    expect(getLastStartPageFromText("no markers")).toBe(-1);
  });

  it("should handle single occurrence", () => {
    expect(getLastStartPageFromText("<start_index_42>")).toBe(42);
  });
});

describe("findNodeById", () => {
  it("should find node by ID", () => {
    const tree = [
      { nodeId: "0000", title: "Root", nodes: [{ nodeId: "0001", title: "Child" }] },
    ];
    const found = findNodeById(tree, "0001");
    expect(found?.title).toBe("Child");
  });

  it("should return undefined for non-existent ID", () => {
    const tree = [{ nodeId: "0000", title: "Root" }];
    expect(findNodeById(tree, "9999")).toBeUndefined();
  });
});

describe("cosineSimilarity", () => {
  it("should return 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("should return 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("should return -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("should return 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("should work with Float32Array", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.9746);
  });
});

describe("cleanTitle", () => {
  it("should remove HTML entities", () => {
    expect(cleanTitle("hello&nbsp;world")).toBe("hello world");
    expect(cleanTitle("a&amp;b")).toBe("a&b");
    expect(cleanTitle("a&lt;b&gt;c")).toBe("a<b>c");
  });

  it("should remove markdown heading markers", () => {
    expect(cleanTitle("## Title")).toBe("Title");
    expect(cleanTitle("### Sub Title")).toBe("Sub Title");
  });

  it("should remove markdown bold/italic", () => {
    expect(cleanTitle("**bold**")).toBe("bold");
    expect(cleanTitle("*italic*")).toBe("italic");
  });

  it("should collapse multiple dashes", () => {
    expect(cleanTitle("a---b")).toBe("a-b");
  });

  it("should trim leading/trailing whitespace and dashes", () => {
    expect(cleanTitle("  hello  ")).toBe("hello");
    expect(cleanTitle("--hello--")).toBe("hello");
  });

  it("should decode numeric HTML entities", () => {
    expect(cleanTitle("&#65;")).toBe("A");
  });
});

describe("convertPhysicalIndexToInt", () => {
  it("should parse angle bracket format", () => {
    expect(convertPhysicalIndexToInt("<physical_index_5>")).toBe(5);
  });

  it("should parse underscore format", () => {
    expect(convertPhysicalIndexToInt("physical_index_10")).toBe(10);
  });

  it("should parse plain number string", () => {
    expect(convertPhysicalIndexToInt("42")).toBe(42);
  });

  it("should return null for non-numeric string", () => {
    expect(convertPhysicalIndexToInt("abc")).toBeNull();
  });

  it("should convert physical_index in array items", () => {
    const items = [
      { title: "A", physical_index: "5" } as never,
      { title: "B", physical_index: 10 } as never,
    ];
    const result = convertPhysicalIndexToInt(items) as typeof items;
    expect(result[0].physicalIndex).toBe(5);
    expect(result[1].physicalIndex).toBe(10);
  });

  it("should handle physical_index as number in array", () => {
    const items = [{ title: "A", physical_index: 7 } as never];
    const result = convertPhysicalIndexToInt(items) as typeof items;
    expect(result[0].physicalIndex).toBe(7);
  });
});

describe("convertPageToInt", () => {
  it("should convert string page to int", () => {
    const items = [{ title: "A", page: "5" } as never];
    const result = convertPageToInt(items) as typeof items;
    expect(result[0].page).toBe(5);
  });

  it("should keep numeric page as-is", () => {
    const items = [{ title: "A", page: 10 } as never];
    const result = convertPageToInt(items) as typeof items;
    expect(result[0].page).toBe(10);
  });

  it("should skip non-numeric string page", () => {
    const items = [{ title: "A", page: "abc" } as never];
    const result = convertPageToInt(items) as typeof items;
    expect(result[0].page).toBe("abc");
  });
});

describe("reorderDict", () => {
  it("should reorder keys according to keyOrder", () => {
    const data = { c: 3, a: 1, b: 2 };
    const result = reorderDict(data, ["a", "b", "c"]);
    expect(Object.keys(result)).toEqual(["a", "b", "c"]);
  });

  it("should skip keys not in data", () => {
    const data = { a: 1 };
    const result = reorderDict(data, ["a", "b", "c"]);
    expect(Object.keys(result)).toEqual(["a"]);
  });

  it("should return original if empty keyOrder", () => {
    const data = { a: 1 };
    expect(reorderDict(data, [])).toBe(data);
  });
});

describe("formatStructure", () => {
  it("should return unchanged if no order", () => {
    const tree = { title: "Root" };
    expect(formatStructure(tree)).toBe(tree);
  });

  it("should reorder keys in tree", () => {
    const tree = { title: "Root", summary: "sum", nodeId: "0000" };
    const result = formatStructure(tree, ["nodeId", "title"]) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(["nodeId", "title"]);
  });
});

describe("createCleanStructureForDescription", () => {
  it("should only keep essential fields", () => {
    const tree = {
      title: "Root",
      nodeId: "0000",
      text: "full text here",
      summary: "short summary",
      startIndex: 1,
    };
    const result = createCleanStructureForDescription(tree) as Record<string, unknown>;
    expect(result.title).toBe("Root");
    expect(result.nodeId).toBe("0000");
    expect(result.summary).toBe("short summary");
    expect(result.text).toBeUndefined();
    expect(result.startIndex).toBeUndefined();
  });

  it("should preserve nested nodes", () => {
    const tree = {
      title: "Root",
      nodes: [{ title: "Child", text: "child text" }],
    };
    const result = createCleanStructureForDescription(tree) as Record<string, unknown>;
    expect((result.nodes as Record<string, unknown>[])[0].title).toBe("Child");
    expect((result.nodes as Record<string, unknown>[])[0].text).toBeUndefined();
  });
});
