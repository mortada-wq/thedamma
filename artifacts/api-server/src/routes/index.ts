import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songsRouter from "./songs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(songsRouter);

export default router;
