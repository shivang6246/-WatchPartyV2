package com.watchparty.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface PendingRegistrationRepository extends JpaRepository<PendingRegistration, UUID> {

    Optional<PendingRegistration> findByEmailIgnoreCase(String email);

    Optional<PendingRegistration> findByTokenHash(String tokenHash);

    /**
     * Spends a sign-up by its link in one guarded statement, so the link and
     * the code (or two tabs) can never both create the account.
     *
     * @return 1 if this call spent it, 0 otherwise
     */
    @Transactional
    @Modifying
    @Query("""
            update PendingRegistration p set p.usedAt = :now
            where p.tokenHash = :hash and p.usedAt is null and p.expiresAt > :now
            """)
    int spendByToken(@Param("hash") String tokenHash, @Param("now") Instant now);

    /** Same guard, by address and code, plus the cap on wrong codes. */
    @Transactional
    @Modifying
    @Query("""
            update PendingRegistration p set p.usedAt = :now
            where upper(p.email) = upper(:email) and p.codeHash = :hash and p.usedAt is null
              and p.expiresAt > :now and p.attempts < :maxAttempts
            """)
    int spendByCode(
            @Param("email") String email,
            @Param("hash") String codeHash,
            @Param("now") Instant now,
            @Param("maxAttempts") int maxAttempts);

    @Transactional
    @Modifying
    @Query("update PendingRegistration p set p.attempts = p.attempts + 1 where upper(p.email) = upper(:email) and p.usedAt is null")
    int countFailedAttempt(@Param("email") String email);

    /** Registering the same address again replaces the earlier sign-up. */
    @Transactional
    @Modifying
    @Query("delete from PendingRegistration p where upper(p.email) = upper(:email)")
    int deleteByEmail(@Param("email") String email);

    @Transactional
    @Modifying
    @Query("delete from PendingRegistration p where p.expiresAt < :cutoff or p.usedAt is not null")
    int deleteExpiredOrUsedBefore(@Param("cutoff") Instant cutoff);
}
