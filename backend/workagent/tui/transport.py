"""Bounded threads: cancellation never releases an outstanding HTTP read slot."""
import asyncio
from concurrent.futures import ThreadPoolExecutor


class ReadLane:
    def __init__(self):
        self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='workagent-read')
        self.future=None

    @property
    def busy(self):
        return self.future is not None and not self.future.done()

    async def read(self, function, *args, **kwargs):
        if self.busy:return None
        # Track the concurrent future, not its cancelable asyncio wrapper.
        self.future=self.executor.submit(function,*args,**kwargs)
        return await wait_future(self.future)

    def close(self):
        self.executor.shutdown(wait=False,cancel_futures=True)


async def wait_future(future):
    # Cancellation only detaches the awaiter. The concurrent future remains the
    # authoritative slot owner until the actual HTTP function exits. A short
    # timer also works in terminal hosts whose thread wakeup socket is restricted.
    while not future.done():
        await asyncio.sleep(.025)
    return future.result()
