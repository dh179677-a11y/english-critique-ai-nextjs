import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const classPageSource = await readFile(
  new URL("../app/teacher/classes/[id]/page.tsx", import.meta.url),
  "utf8"
);
const libraryPageSource = await readFile(
  new URL("../app/teacher/storyflow/library/page.tsx", import.meta.url),
  "utf8"
);

assert.match(
  classPageSource,
  /hydrateTeacherStoryflowLibrary/u,
  "class course page must hydrate teacher Storyflow library folders"
);
assert.match(
  classPageSource,
  /getTeacherStoryflowFolders/u,
  "class course page must read Storyflow folders as course levels"
);
assert.doesNotMatch(
  classPageSource,
  /getClassMaterials\(/u,
  "class course page must not render hard-coded Stage material cards"
);
assert.match(
  classPageSource,
  /publishCourseLevelToClass/u,
  "class course page must support assigning a course-level folder to class students"
);
assert.match(
  classPageSource,
  /选择学生分配[\s\S]*selectedCourseStudentIds/u,
  "class course page must let teachers assign different course levels to selected students"
);
assert.match(
  classPageSource,
  /publishStoryflowAssignments[\s\S]*courseLevelDocuments/u,
  "class course assignment must publish every document in the selected folder"
);
assert.match(
  libraryPageSource,
  /课程级别/u,
  "library page should present folders as course levels"
);
assert.match(
  libraryPageSource,
  /placeholder="例如：Stage 1 \/ Stage 2 \/ Stage 3"/u,
  "library page should guide teachers to create Stage course-level folders"
);

console.log("Storyflow course folders are wired into class materials and assignment.");
