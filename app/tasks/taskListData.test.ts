import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native type-stripping test runner requires the extension.
import { buildStudentTaskListItems } from "./taskListData.ts";

test("task list projection excludes recording and document detail payloads", () => {
  const items = buildStudentTaskListItems(
    [
      {
        id: "assignment-1",
        teacherUsername: "teacher",
        teacherDisplayName: "Teacher",
        studentUsername: "student",
        studentDisplayName: "Student",
        documentId: "document-1",
        documentTitle: "Spots",
        createdAt: 100,
        updatedAt: 200,
        enabledModules: ["shadow"],
        shadowSubmission: {
          completedAt: 300,
          audioDataUrl: `data:audio/webm;base64,${"a".repeat(10_000)}`,
          audioMimeType: "audio/webm",
          audioFileName: "recording.webm",
          durationSec: 12,
          clipCount: 1,
        },
      },
    ],
    [
      {
        id: "document-1",
        teacherUsername: "teacher",
        sourceName: "spots.pdf",
        createdAt: 50,
        updatedAt: 250,
        folderId: "stage-1",
        thumbnailObjectKey: "covers/spots.webp",
        pageCount: 10,
        images: [`data:image/png;base64,${"b".repeat(10_000)}`],
        pageObjectKeys: ["pages/spots-1.png"],
        analysis: {
          title: "Spots",
          summary: "large analysis payload that must stay off the list page",
          fullText: "Full story",
          characters: ["Kipper"],
          setting: { time: "day", place: "home" },
          mindMap: { beginning: [], middle: [], end: [] },
          pages: [],
          keywords: [],
          teacherGuide: [],
        },
      },
    ]
  );

  assert.deepEqual(items, [
    {
      id: "assignment-1",
      teacherUsername: "teacher",
      teacherDisplayName: "Teacher",
      documentTitle: "Spots",
      createdAt: 100,
      folderId: "stage-1",
      documentSortOrder: 250,
      lastStudiedAt: 300,
      coverObjectKey: "pages/spots-1.png",
      coverImageUrl: "/api/storyflow/file?key=pages%2Fspots-1.png",
    },
  ]);

  const serialized = JSON.stringify(items);
  assert.equal(serialized.includes("audioDataUrl"), false);
  assert.equal(serialized.includes("large analysis payload"), false);
  assert.ok(serialized.length < 500);
});
