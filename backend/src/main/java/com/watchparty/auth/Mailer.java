package com.watchparty.auth;

/**
 * Sending one transactional email.
 *
 * <p>Two implementations, chosen by whether {@code spring.mail.host} is set:
 * SMTP in a real deployment, and a logging stand-in for development, so the
 * app runs with no mail account at all — the same shape as the YouTube key,
 * which is optional in exactly the same way.
 */
public interface Mailer {

    void send(String to, String subject, String body);

    /** Whether mail actually leaves the machine. Verification is only enforced when it does. */
    boolean configured();
}
