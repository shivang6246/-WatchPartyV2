# ---- build ----------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies resolve in their own layer so code changes do not re-download them.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q clean package -DskipTests

# ---- run ------------------------------------------------------------------
FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

# Never run the app as root.
RUN groupadd --system watchparty && useradd --system --gid watchparty watchparty
COPY --from=build /build/target/*.jar app.jar
USER watchparty

EXPOSE 8080

# Heap is capped as a share of the container limit; a held WebSocket session
# costs roughly 30-50KB of heap, so connection count is what sizes this.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=70 -XX:+UseG1GC"

HEALTHCHECK --interval=30s --timeout=3s --start-period=45s --retries=3 \
  CMD wget -qO- http://localhost:8080/actuator/health/readiness || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
