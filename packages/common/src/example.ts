import logger from "./logger";

logger.info("Hello, world!");
logger.error("Hello, world!", { extra: "extra", extra2: "extra2" });
logger.warn("Hello, world!");
logger.debug("Hello, world!");
logger.error(new Error("Hello, world!"));
logger.info({ obj: "some_object" });
