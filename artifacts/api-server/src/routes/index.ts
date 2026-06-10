import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songsRouter from "./songs";
import adminRouter from "./admin";
import authRouter from "./auth";
import projectsRouter from "./projects";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(adminRouter);
router.use(songsRouter);
router.use(projectsRouter);
router.use(usersRouter);

export default router;
