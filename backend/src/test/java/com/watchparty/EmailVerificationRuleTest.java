package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;

import com.watchparty.auth.EmailVerificationService;
import org.junit.jupiter.api.Test;

class EmailVerificationRuleTest {

    @Test
    void withoutAnOverrideItFollowsWhetherMailCanBeSent() {
        // A machine with no SMTP host cannot deliver the link, so holding an
        // account back there would only lock the developer out.
        assertThat(EmailVerificationService.required(null, true)).isTrue();
        assertThat(EmailVerificationService.required(null, false)).isFalse();
    }

    @Test
    void anExplicitSettingWinsEitherWay() {
        assertThat(EmailVerificationService.required(false, true)).isFalse();
        assertThat(EmailVerificationService.required(true, false)).isTrue();
    }
}
