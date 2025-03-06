import winston from "winston";
import { consoleFormat } from "winston-console-format";

// Custom log levels with abbreviations
const customLevels = {
  levels: {
    ERR: 0,
    WRN: 1,
    INF: 2,
    DBG: 3,
  },
  colors: {
    ERR: "red",
    WRN: "yellow",
    INF: "green",
    DBG: "blue",
  },
};

// Add custom levels to winston
winston.addColors(customLevels.colors);

// Define the type for our logger methods
type LogMethod = winston.LeveledLogMethod;

// Define the type for our custom logger
interface CustomLogger {
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
  ERR: LogMethod;
  WRN: LogMethod;
  INF: LogMethod;
  DBG: LogMethod;
}

// Create the console transport with appropriate settings
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.padLevels(),
    winston.format.errors({ stack: true }),
    consoleFormat({
      showMeta: true,
      metaStrip: ["timestamp", "service"],
      inspectOptions: {
        depth: Infinity,
        colors: true,
        maxArrayLength: Infinity,
        breakLength: 120,
        compact: Infinity,
      },
    })
  ),
});

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: "DBG",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.ms(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: "Test" },
  transports: [consoleTransport],
  silent: process.env.NODE_ENV === "test", // Also silence at logger level for extra safety
}) as unknown as winston.Logger &
  Record<keyof typeof customLevels.levels, winston.LeveledLogMethod>;

// Create the wrapped logger with both standard and custom methods
const wrappedLogger: CustomLogger = {
  error: logger.ERR.bind(logger),
  warn: logger.WRN.bind(logger),
  info: logger.INF.bind(logger),
  debug: logger.DBG.bind(logger),
  ERR: logger.ERR.bind(logger),
  WRN: logger.WRN.bind(logger),
  INF: logger.INF.bind(logger),
  DBG: logger.DBG.bind(logger),
};

export const cleanup = async () => {
  // Close all transports
  await Promise.all(
    logger.transports.map(
      (t) =>
        new Promise<void>((resolve) => {
          if (typeof t.close === "function") {
            t.on("finish", resolve);
            t.close();
          } else {
            resolve();
          }
        })
    )
  );
};

export default wrappedLogger;
