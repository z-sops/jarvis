# Build only after installation approval. The PowerShell wrapper checks the
# already-installed base image ID before and after this build; no floating latest.
FROM nikolaik/python-nodejs:python3.11-nodejs20
USER root
WORKDIR /opt/orbit-image-build
COPY runtime-lock.json install-artifacts.py ./
RUN ORBIT_IMAGE_BUILD=1 python3 install-artifacts.py
RUN command -v git && git init /opt/hermes && \
    git -C /opt/hermes remote add origin https://github.com/NousResearch/hermes-agent.git && \
    git -C /opt/hermes fetch --depth=1 origin 818c13be1dc4fd28987e1e881a9408224afd4535 && \
    git -C /opt/hermes checkout --detach FETCH_HEAD && \
    test "$(git -C /opt/hermes rev-parse HEAD)" = 818c13be1dc4fd28987e1e881a9408224afd4535
WORKDIR /opt/hermes
# Hermes blocks project wheels; install locked dependencies only.
# Its exact source tree is loaded by the fixed PYTHONPATH wrapper below.
RUN /opt/orbit-image-build/uv sync --frozen --no-dev --no-install-project \
    --python /opt/orbit-python/bin/python3 --no-python-downloads \
    --extra web --extra mcp --extra pty --extra cron
RUN /opt/hermes/.venv/bin/python scripts/write_install_stamp.py \
    --output /opt/hermes/install-stamp.json \
    --commit 818c13be1dc4fd28987e1e881a9408224afd4535 \
    --base-version 0.21.6 --distance 0 --source ci \
    --distribution docker --update-mechanism external
# Explicit interpreter/source path survives the runner's scrubbed PATH/env.
RUN printf '%s\n' '#!/bin/sh' \
    'export PYTHONPATH=/opt/hermes' \
    'export PYTHONDONTWRITEBYTECODE=1' \
    'exec /opt/hermes/.venv/bin/python -m hermes_cli.main "$@"' \
    > /usr/local/bin/hermes && chmod 0755 /usr/local/bin/hermes && \
    mkdir -p /home/orbit /workspace /input && \
    chown 10001:10001 /home/orbit /workspace && \
    chmod -R a+rX,go-w /opt/hermes /opt/orbit-python
ENV HOME=/home/orbit
ENV PATH=/usr/local/bin:/usr/bin:/bin
USER 10001:10001
WORKDIR /workspace
# This is an offline build smoke, not a model request or production task proof.
RUN --network=none node -e "if(+process.versions.node.split('.')[0]<20)process.exit(1)" && \
    opencode --version && hermes --version && \
    PYTHONPATH=/opt/hermes /opt/hermes/.venv/bin/python -c "import openai,fastapi,uvicorn,mcp; import gateway.platforms.api_server"
LABEL orbit.runtime.hermes="0.21.6" \
    orbit.runtime.hermes.commit="818c13be1dc4fd28987e1e881a9408224afd4535" \
    orbit.runtime.opencode="1.18.35"
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["--version"]
