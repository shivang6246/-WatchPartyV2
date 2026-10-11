package com.watchparty.ai;

/**
 * The language model behind the room assistant: one prompt in, one reply out.
 *
 * <p>The seam that lets a deployment run with no model at all (no API key is
 * "assistant off", like no SMTP host is "mail to the log") and keeps the
 * provider's own types out of the room code.
 */
public interface AssistantModel {

    /** False when no model is configured; {@link #ask} must not be called then. */
    boolean configured();

    /**
     * Blocks for as long as the model takes, so never call it on a thread that
     * serves anything else.
     *
     * @throws Unavailable when the model could not answer
     */
    Answer ask(String prompt);

    /**
     * @param text what the model said; null or blank when it declined to say
     *     anything (a safety block, an empty candidate)
     */
    record Answer(String text, long promptTokens, long completionTokens) {}

    /** The model could not be reached, or refused the request. */
    class Unavailable extends RuntimeException {

        private final boolean outOfQuota;

        public Unavailable(String message, boolean outOfQuota, Throwable cause) {
            super(message, cause);
            this.outOfQuota = outOfQuota;
        }

        /**
         * The provider's own rate limit: on a free key this is the ordinary
         * way a day ends, not a fault.
         */
        public boolean outOfQuota() {
            return outOfQuota;
        }
    }
}
