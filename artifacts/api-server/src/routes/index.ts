import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songsRouter from "./songs";
import adminRouter from "./admin";
import authRouter from "./auth";
import projectsRouter from "./projects";
import usersRouter from "./users";
import groupsRouter from "./groups";
import projectMembersRouter from "./project-members";
import tasksRouter from "./tasks";
import projectChatRouter from "./project-chat";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(adminRouter);
router.use(songsRouter);
router.use(projectsRouter);
router.use(usersRouter);
router.use(groupsRouter);
router.use(projectMembersRouter);
router.use(tasksRouter);
router.use(projectChatRouter);

export default router;
