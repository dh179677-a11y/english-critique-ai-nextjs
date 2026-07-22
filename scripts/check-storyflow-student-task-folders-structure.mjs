import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const checks = [
  {
    file: "lib/storyflowStore.ts",
    assertions: [
      ["StoryflowFolder includes coverImage", /interface StoryflowFolder[\s\S]*coverImage\?: string;/],
      ["StoryflowFolder includes coverObjectKey", /interface StoryflowFolder[\s\S]*coverObjectKey\?: string;/],
      ["folder normalization preserves coverObjectKey", /coverObjectKey:\s*typeof item\.coverObjectKey/],
      ["teacher settings include student task display mode", /StoryflowStudentTaskDisplayMode/],
      ["teacher settings normalize display mode", /normalizeStoryflowTeacherSettings/],
    ],
  },
  {
    file: "app/teacher/storyflow/library/page.tsx",
    assertions: [
      ["library can choose folder cover", /handleChooseFolderCover/],
      ["library uploads folder cover images", /uploadStoryflowAsset\(file,\s*"page"\)/],
      ["library has folder cover action text", /设置封面/],
      ["library has image file input", /accept="image\/\*"/],
      ["library limits course sorting to one concrete folder", /canManuallySortCurrentFolder/],
      ["library tells teacher sorting affects current folder", /当前课程级别内顺序已更新/],
      ["library lets teacher choose folder cover only mode", /分类封面/],
      ["library lets teacher choose preview mode", /分类预览/],
      ["library persists student task display mode", /updateTeacherStoryflowSettings/],
    ],
  },
  {
    file: "app/tasks/page.tsx",
    assertions: [
      ["student task page passes folders by teacher", /initialFoldersByTeacher=/],
      ["student task page reads folderId from document", /folderId:\s*document\?\.folderId/],
      ["student task page passes document sort order", /documentSortOrder:\s*getDocumentSortValue\(document\)/],
      ["student task page calculates lastStudiedAt", /lastStudiedAt:\s*getAssignmentLastStudiedAt\(task\)/],
      ["student task page passes display mode", /initialDisplayMode=/],
    ],
  },
  {
    file: "components/student/StudentTasksClient.tsx",
    assertions: [
      ["student client receives StoryflowFolder type", /type StoryflowFolder/],
      ["student client groups tasks by course level", /courseLevelGroups/],
      ["student client keeps teacher course order inside groups", /right\.documentSortOrder - left\.documentSortOrder/],
      ["student client does not sort courses by last studied first", { not: /progressDiff/ }],
      ["student client renders last studied marker", /上次学过/],
      ["student client renders continue action", /继续学习/],
      ["student client uses folder cover", /folder\.coverObjectKey/],
      ["student client supports category cover mode", /renderFolderCoverMode/],
      ["student client supports preview mode", /renderFolderPreviewMode/],
      ["student course and folder cards share exact card shell", /renderCourseCardShell[\s\S]*renderTaskCard[\s\S]*renderCourseCardShell[\s\S]*renderFolderCoverMode[\s\S]*renderCourseCardShell/],
      ["student shared card shell keeps original task card chrome", /rounded-\[1\.8rem\][\s\S]*bg-white p-4 shadow-sm[\s\S]*hover:shadow-\[0_18px_50px_rgba\(56,189,248,0\.12\)\]/],
      ["student shared cover frame keeps original image size", /aspect-\[3\/4\][\s\S]*rounded-\[1\.35rem\][\s\S]*text-\[1\.9rem\]/],
      ["student preview shows three courses", /group\.tasks\.slice\(0,\s*3\)/],
      ["student client renders enter button", /进入/],
    ],
  },
];

const failures = [];

for (const check of checks) {
  const source = read(check.file);
  for (const [label, pattern] of check.assertions) {
    const passed =
      pattern instanceof RegExp
        ? pattern.test(source)
        : pattern.not instanceof RegExp
          ? !pattern.not.test(source)
          : false;
    if (!passed) {
      failures.push(`${check.file}: ${label}`);
    }
  }
}

if (failures.length) {
  console.error("Storyflow student task folder structure check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Storyflow student task folder structure check passed.");
