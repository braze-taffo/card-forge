import unittest
from capacity import next_start, has_capacity

class CapacityTest(unittest.TestCase):
    def test_four_previews_and_queue_advancement(self):
        first = {'status':'ready', 'createdAt':1}
        second = {'status':'queued', 'createdAt':2}
        third = {'status':'queued', 'createdAt':3}
        self.assertIs(next_start([first, third, second]), second)
        second['status'] = 'starting'
        self.assertIsNone(next_start([first, second, third]))
        second['status'] = 'ready'
        self.assertIs(next_start([first, second, third]), third)
        fourth = {'status':'ready', 'createdAt':4}
        third['status'] = 'ready'
        fifth = {'status':'queued', 'createdAt':5}
        self.assertIsNone(next_start([first, second, third, fourth, fifth]))
        first['status'] = 'closed'
        self.assertIs(next_start([first, second, third, fourth, fifth]), fifth)

    def test_admission_includes_reserved_slots(self):
        values = [{'status':'ready'}] * 4 + [{'status':'queued'}] * 3
        self.assertFalse(has_capacity(values))
        self.assertTrue(has_capacity(values[:-1]))
        self.assertTrue(has_capacity(values[:-1] + [{'status':'expired'}]))

if __name__ == '__main__':
    unittest.main()
