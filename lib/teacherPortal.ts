import {
  getTeacherClasses,
  getTeacherStudents,
  type SessionUser,
} from "@/lib/clientAuth";
import { getUserRecords } from "@/lib/clientRecords";

export interface TeacherModule {
  slug: string;
  title: string;
  subtitle: string;
  badge: string;
  tone: string;
  cardClass?: string;
  innerClass?: string;
  badgeClass?: string;
  titleClass?: string;
  subtitleClass?: string;
  labelClass?: string;
}

export interface TeacherOverview {
  totalStudents: number;
  activeStudents: number;
  inactiveStudents: number;
  neverLoggedStudents: number;
  totalClasses: number;
  totalRecords: number;
}

export const primaryTeacherModules: TeacherModule[] = [
  {
    slug: "students",
    title: "学员管理",
    subtitle: "创建、编辑、停用学生账号",
    badge: "学",
    tone: "from-sky-200 via-cyan-100 to-white",
    cardClass: "ring-1 ring-sky-100 shadow-[0_20px_50px_rgba(56,189,248,0.14)]",
    innerClass: "bg-white/78",
    badgeClass: "bg-sky-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
    labelClass: "text-sky-700",
  },
  {
    slug: "classes",
    title: "班级管理",
    subtitle: "维护班级与学员归属",
    badge: "班",
    tone: "from-blue-200 via-sky-100 to-white",
    cardClass: "ring-1 ring-blue-100 shadow-[0_20px_50px_rgba(59,130,246,0.14)]",
    innerClass: "bg-white/78",
    badgeClass: "bg-blue-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
    labelClass: "text-blue-700",
  },
  {
    slug: "team",
    title: "员工管理",
    subtitle: "组织老师与内部角色分工",
    badge: "员",
    tone: "from-amber-100 via-orange-50 to-white",
    cardClass: "ring-1 ring-amber-100 shadow-[0_20px_50px_rgba(245,158,11,0.14)]",
    innerClass: "bg-white/78",
    badgeClass: "bg-amber-500 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
    labelClass: "text-amber-700",
  },
  {
    slug: "data",
    title: "数据中心",
    subtitle: "查看学员与测评数据汇总",
    badge: "数",
    tone: "from-cyan-200 via-sky-100 to-white",
    cardClass: "ring-1 ring-cyan-100 shadow-[0_20px_50px_rgba(6,182,212,0.14)]",
    innerClass: "bg-white/78",
    badgeClass: "bg-cyan-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
    labelClass: "text-cyan-700",
  },
];

export const sideTeacherModules: TeacherModule[] = [
  {
    slug: "courses",
    title: "课程管理",
    subtitle: "课程包与教学内容",
    badge: "课",
    tone: "from-indigo-500 via-blue-500 to-sky-400",
    cardClass: "ring-1 ring-white/45",
    badgeClass: "bg-white text-indigo-700",
    titleClass: "text-white",
    subtitleClass: "text-white/90",
  },
  {
    slug: "hours",
    title: "学员课时",
    subtitle: "课时余额与到期提醒",
    badge: "时",
    tone: "from-cyan-500 via-sky-500 to-blue-400",
    cardClass: "ring-1 ring-white/45",
    badgeClass: "bg-white text-cyan-700",
    titleClass: "text-white",
    subtitleClass: "text-white/90",
  },
  {
    slug: "appointments",
    title: "约课管理",
    subtitle: "排课与预约安排",
    badge: "约",
    tone: "from-violet-500 via-fuchsia-500 to-indigo-500",
    cardClass: "ring-1 ring-white/45",
    badgeClass: "bg-white text-violet-700",
    titleClass: "text-white",
    subtitleClass: "text-white/90",
  },
  {
    slug: "finance",
    title: "财务中心",
    subtitle: "支付、续费与统计",
    badge: "财",
    tone: "from-rose-500 via-pink-500 to-fuchsia-400",
    cardClass: "ring-1 ring-white/45",
    badgeClass: "bg-white text-rose-700",
    titleClass: "text-white",
    subtitleClass: "text-white/90",
  },
];

export const utilityTeacherModules: TeacherModule[] = [
  {
    slug: "storyflow",
    title: "图文导学",
    subtitle: "图片/PDF生成导图与看图说话",
    badge: "图",
    tone: "from-emerald-100 via-teal-50 to-white",
    cardClass: "ring-1 ring-emerald-100 shadow-[0_18px_45px_rgba(16,185,129,0.12)]",
    badgeClass: "bg-emerald-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
  },
  {
    slug: "events",
    title: "活动比赛",
    subtitle: "校区活动与竞赛通知",
    badge: "活",
    tone: "from-orange-100 via-amber-50 to-white",
    cardClass: "ring-1 ring-orange-100 shadow-[0_18px_45px_rgba(249,115,22,0.12)]",
    badgeClass: "bg-orange-500 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
  },
  {
    slug: "enrollment",
    title: "招生宝",
    subtitle: "招生线索与咨询跟进",
    badge: "招",
    tone: "from-violet-100 via-indigo-50 to-white",
    cardClass: "ring-1 ring-violet-100 shadow-[0_18px_45px_rgba(139,92,246,0.12)]",
    badgeClass: "bg-violet-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
  },
  {
    slug: "news",
    title: "学校动态",
    subtitle: "发布公告与校区动态",
    badge: "动",
    tone: "from-sky-100 via-cyan-50 to-white",
    cardClass: "ring-1 ring-sky-100 shadow-[0_18px_45px_rgba(14,165,233,0.12)]",
    badgeClass: "bg-sky-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
  },
  {
    slug: "store",
    title: "分销商城",
    subtitle: "周边、研学与活动商品",
    badge: "商",
    tone: "from-blue-100 via-indigo-50 to-white",
    cardClass: "ring-1 ring-blue-100 shadow-[0_18px_45px_rgba(59,130,246,0.12)]",
    badgeClass: "bg-blue-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
  },
];

export const allTeacherModules = [
  ...primaryTeacherModules,
  ...sideTeacherModules,
  ...utilityTeacherModules,
  {
    slug: "messages",
    title: "消息",
    subtitle: "查看系统通知与待办提醒",
    badge: "消",
    tone: "from-green-300 to-emerald-200",
    badgeClass: "bg-emerald-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
  },
  {
    slug: "settings",
    title: "设置",
    subtitle: "管理校区资料与账号偏好",
    badge: "设",
    tone: "from-indigo-300 to-violet-200",
    badgeClass: "bg-indigo-600 text-white",
    titleClass: "text-slate-900",
    subtitleClass: "text-slate-600",
  },
];

export const getTeacherModule = (slug: string) =>
  allTeacherModules.find((module) => module.slug === slug);

export const getTeacherOverview = (session: SessionUser): TeacherOverview => {
  const students = getTeacherStudents(session.username);
  const classes = getTeacherClasses(session.username);
  const totalRecords = students.reduce(
    (sum, student) => sum + getUserRecords(student.username).length,
    0
  );

  return {
    totalStudents: students.length,
    activeStudents: students.filter((student) => student.status !== "inactive")
      .length,
    inactiveStudents: students.filter((student) => student.status === "inactive")
      .length,
    neverLoggedStudents: students.filter((student) => !student.lastLoginAt).length,
    totalClasses: classes.length,
    totalRecords,
  };
};
