# ============================================
# Stage 1: Build React frontend
# ============================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy React dependency manifests first (Docker layer caching)
COPY React/web-rtc/package*.json ./
RUN npm install

# Copy React source code and build
COPY React/web-rtc/ ./
RUN npm run build

# ============================================
# Stage 2: Build Spring Boot backend
# ============================================
FROM maven:3.9-eclipse-temurin-21 AS backend-builder
WORKDIR /app/backend

# Copy Maven descriptor to cache dependencies
COPY WebRtc/webrtc/pom.xml .
RUN mvn dependency:go-offline -B

# Copy Spring Boot source files
COPY WebRtc/webrtc/src ./src

# Copy optimized frontend static assets into Spring Boot's resources folder
COPY --from=frontend-builder /app/frontend/build/ ./src/main/resources/static/

# Package the entire application into a single runnable JAR (skipping unit tests for deployment speed)
RUN mvn clean package -DskipTests

# ============================================
# Stage 3: Minimal production runtime
# ============================================
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Copy the packaged Spring Boot fat JAR containing the integrated frontend
COPY --from=backend-builder /app/backend/target/webrtc-0.0.1-SNAPSHOT.jar app.jar

# Render injects PORT env var; Spring Boot reads it via application.properties
EXPOSE 8080
ENV PORT=8080

# Run the single integrated service
ENTRYPOINT ["java", "-jar", "app.jar"]
