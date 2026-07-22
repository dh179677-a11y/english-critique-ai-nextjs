export type StoryCharacterProfile = {
  name: string;
  role: string;
  family?: string;
  visual: string;
  notes?: string;
};

export type StoryWorldCharacterProfile = {
  storyWorld: string;
  description: string;
  recognitionRules: string[];
  characters: StoryCharacterProfile[];
};

export const oxfordReadingTreeCharacterProfile: StoryWorldCharacterProfile = {
  storyWorld: "Oxford Reading Tree - Biff, Chip and Kipper",
  description: "Main family members, friends, teachers and recurring supporting characters.",
  recognitionRules: [
    "Use a character name only when the visible character clearly matches the profile or the page text names them.",
    "If uncertain, say '可能是...' instead of stating it as fact.",
    "Do not infer family relationships only from appearance.",
    "Do not call Mrs May 'Grandma'. Mrs May is a teacher unless the page clearly says otherwise.",
    "Do not call any elderly woman Grandma unless she matches Grandma's profile or the text names her.",
  ],
  characters: [
    {
      name: "Kipper",
      role: "child",
      family: "Biff and Chip's younger brother; Mum and Dad's son",
      visual: "young blond boy, short hair, round face, often smiling",
    },
    {
      name: "Biff",
      role: "child",
      family: "Chip and Kipper's sister; Mum and Dad's daughter",
      visual: "girl with brown bob haircut, often has a fringe",
    },
    {
      name: "Chip",
      role: "child",
      family: "Biff and Kipper's brother; Mum and Dad's son",
      visual: "boy with brown hair",
    },
    {
      name: "Mum",
      role: "mother",
      family: "Biff, Chip and Kipper's mum; Dad's wife",
      visual: "adult woman with blonde hair",
    },
    {
      name: "Dad",
      role: "father",
      family: "Biff, Chip and Kipper's dad; Mum's husband",
      visual: "adult man with brown hair",
    },
    {
      name: "Grandma",
      role: "grandmother",
      family: "Grandma of Biff, Chip and Kipper",
      visual: "elderly woman with curly white hair and glasses",
    },
    {
      name: "Floppy",
      role: "dog",
      family: "Family dog of Biff, Chip and Kipper",
      visual: "yellow dog with floppy ears and red collar",
    },
    {
      name: "William and Wendy's Dad",
      role: "father",
      family: "Father of William and Wendy",
      visual: "Black adult man with short curly black hair",
    },
    {
      name: "William and Wendy's Mum",
      role: "mother",
      family: "Mother of William and Wendy",
      visual: "Black adult woman with short curly black hair and earrings",
    },
    {
      name: "Wendy",
      role: "child",
      family: "William's sister or close family member",
      visual: "Black girl with long black hair",
    },
    {
      name: "William",
      role: "child",
      family: "Wendy's brother or close family member",
      visual: "Black boy with short curly black hair, often smiling",
    },
    {
      name: "Anna",
      role: "child",
      family: "Friend or classmate character",
      visual: "girl with dark hair, often shown with tied or side-parted hair",
    },
    {
      name: "Nick",
      role: "child",
      family: "Friend or classmate character",
      visual: "boy with black hair",
    },
    {
      name: "Mrs May",
      role: "teacher",
      family: "Teacher or adult helper",
      visual: "older woman with curly grey hair, round face",
      notes: "Do not identify her as Grandma.",
    },
    {
      name: "Mr Johnson",
      role: "teacher or adult",
      family: "Adult school/community character",
      visual: "adult man with bald or receding hairline and dark moustache",
    },
  ],
};

export const formatStoryCharacterProfileForPrompt = (
  profile: StoryWorldCharacterProfile = oxfordReadingTreeCharacterProfile
) =>
  [
    `人物识别参考：${profile.storyWorld}`,
    profile.description,
    "识别规则：",
    ...profile.recognitionRules.map((rule) => `- ${rule}`),
    "角色列表：",
    ...profile.characters.map((character) =>
      [
        `- ${character.name}`,
        `role: ${character.role}`,
        character.family ? `family: ${character.family}` : "",
        `visual: ${character.visual}`,
        character.notes ? `notes: ${character.notes}` : "",
      ]
        .filter(Boolean)
        .join("; ")
    ),
  ].join("\n");
