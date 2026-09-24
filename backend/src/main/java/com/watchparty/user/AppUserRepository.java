package com.watchparty.user;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserRepository extends JpaRepository<AppUser, UUID> {

    Optional<AppUser> findByEmailIgnoreCase(String email);

    Optional<AppUser> findByProviderAndProviderId(String provider, String providerId);

    boolean existsByEmailIgnoreCase(String email);
}
