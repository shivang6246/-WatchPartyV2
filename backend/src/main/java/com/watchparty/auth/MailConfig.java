package com.watchparty.auth;

import com.watchparty.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

@Configuration
public class MailConfig {

    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

    /**
     * SMTP where a host is configured, a logging stand-in where it is not.
     *
     * <p>The choice is made on the value being non-blank, not merely present:
     * {@code spring.mail.host=${SMTP_HOST:}} leaves an empty string behind on
     * a machine with no mail account, and sending into that fails at the first
     * message rather than at startup.
     */
    @Bean
    public Mailer mailer(
            @Value("${spring.mail.host:}") String host,
            ObjectProvider<JavaMailSender> senders,
            AppProperties props) {
        JavaMailSender sender = host.isBlank() ? null : senders.getIfAvailable();
        if (sender == null) {
            log.info("No SMTP host configured: verification mail will be written to this log instead.");
            return new LoggingMailer();
        }
        log.info("Sending mail through {} as {}", host, props.mail().from());
        return new SmtpMailer(sender, props.mail().from());
    }

    private record SmtpMailer(JavaMailSender sender, String from) implements Mailer {
        @Override
        public void send(String to, String subject, String body) {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(to);
            message.setSubject(subject);
            message.setText(body);
            sender.send(message);
            log.info("Sent \"{}\" to {}", subject, to);
        }

        @Override
        public boolean configured() {
            return true;
        }
    }

    /**
     * No SMTP host: the mail is written to the log, so a developer can follow
     * the link without a mail account. Verification is not enforced in this
     * mode; see {@code EmailVerificationService.required}.
     */
    private static final class LoggingMailer implements Mailer {
        @Override
        public void send(String to, String subject, String body) {
            log.info("Email that would go to {}:\n--- {} ---\n{}", to, subject, body);
        }

        @Override
        public boolean configured() {
            return false;
        }
    }
}
