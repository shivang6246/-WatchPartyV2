package com.watchparty;

import com.watchparty.config.AppProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
@EnableScheduling
public class WatchPartyApplication {
    public static void main(String[] args) {
        SpringApplication.run(WatchPartyApplication.class, args);
    }
}
