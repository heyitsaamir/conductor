import winston from "winston";

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

const DIM_CODE = "\x1b[2m";
const RESET_CODE = "\x1b[0m";

const chars = {
  singleLine: "▪",
  startLine: "┏",
  line: "┃",
  endLine: "┗",
} as const;

function formatIndentedLine(
  line: string,
  lineType: keyof typeof chars,
  isDimmed = true
): string {
  const padding = " ".repeat(2);
  const connector = chars[lineType];
  return isDimmed
    ? `${DIM_CODE}${connector}${padding}${line}${RESET_CODE}`
    : `${connector}${padding}${line}`;
}

function formatMultilineContent(
  content: string,
  firstLineBright = false
): string {
  const lines = content.split("\n");

  if (lines.length === 1) {
    return formatIndentedLine(lines[0], "singleLine", !firstLineBright);
  }

  return lines
    .map((line, i) => {
      if (i === 0)
        return formatIndentedLine(line, "startLine", !firstLineBright);
      if (i === lines.length - 1)
        return formatIndentedLine(line, "endLine", true);
      return formatIndentedLine(line, "line", true);
    })
    .join("\n");
}

function formatMessage(message: unknown): string {
  const messageStr =
    typeof message === "object" && message !== null
      ? JSON.stringify(message, null, 2)
      : String(message);

  return (
    "\n" +
    (messageStr.includes("\n")
      ? formatMultilineContent(messageStr, true)
      : formatIndentedLine(messageStr, "singleLine", false))
  );
}

function formatMetaInfo(meta: Record<string, unknown>): string {
  if (!Object.keys(meta).length) return "";
  return "\n" + formatMultilineContent(JSON.stringify(meta, null, 2));
}

function formatStack(stack: unknown): string {
  if (typeof stack !== "string") return "";
  return "\n" + formatMultilineContent(stack);
}

// Create the console transport with appropriate settings
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.timestamp({ format: "HH:mm:ss" }),
    winston.format.printf((info: winston.Logform.TransformableInfo) => {
      const prefix = `[${info.level}]`.padEnd(5) + `[${info.timestamp}]`;
      const { level, timestamp, message, stack, ...meta } = info;

      const messageStr = formatMessage(message);
      const metaInfo = formatMetaInfo(meta);
      const stackInfo = formatStack(stack);

      return `${prefix}${messageStr}${metaInfo}${stackInfo}`;
    }),
    winston.format.colorize({ all: true })
  ),
});

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: "DBG",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
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
