import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import symbolsRouter from "./symbols.js";
import analysisRouter from "./analysis.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(symbolsRouter);
router.use(analysisRouter);

export default router;
