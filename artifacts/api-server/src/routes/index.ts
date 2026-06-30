import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import symbolsRouter from "./symbols.js";
import analysisRouter from "./analysis.js";
import agentsRouter from "./agents.js";
import streamRouter from "./stream.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(symbolsRouter);
router.use(analysisRouter);
router.use(agentsRouter);
router.use(streamRouter);

export default router;
