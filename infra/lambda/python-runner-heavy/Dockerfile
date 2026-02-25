FROM public.ecr.aws/lambda/python:3.12

# Build minimal runtime tools and install notebook/runtime dependencies upfront.
RUN dnf install -y tar gzip findutils && dnf clean all

COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN python -m pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py ${LAMBDA_TASK_ROOT}/handler.py

CMD ["handler.lambda_handler"]
