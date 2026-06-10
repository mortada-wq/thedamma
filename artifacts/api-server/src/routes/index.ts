import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songsRouter from "./songs";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(songsRouter);

export default router;
