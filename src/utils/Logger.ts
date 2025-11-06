export const logger = {
    info: (username: string, category: string, message: string) => {
        console.log(`[${username}] [${category}] ${message}`);
    },
    debug: (username: string, category: string, message: string) => {
        if (process.env.DEBUG === "true") {
            console.log(`[DEBUG] [${username}] [${category}] ${message}`);
        }
    },
    warn: (username: string, category: string, message: string) => {
        console.warn(`[WARN] [${username}] [${category}] ${message}`);
    },
    error: (username: string, category: string, message: string) => {
        console.error(`[ERROR] [${username}] [${category}] ${message}`);
    },
};

